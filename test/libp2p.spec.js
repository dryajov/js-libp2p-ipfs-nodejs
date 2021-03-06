'use strict'
/* eslint-env mocha */

const expect = require('chai').expect
const Node = require('../src')
const PeerInfo = require('peer-info')
const multiaddr = require('multiaddr')
const parallel = require('async/parallel')
const map = require('async/map')
const spawn = require('child_process').spawn
const path = require('path')
const pull = require('pull-stream')
const signalling = require('libp2p-webrtc-star/src/sig-server')

describe('libp2p-ipfs-nodejs', () => {
  let nodeA // TCP
  let nodeAMultiaddrTCP

  let nodeB // TCP
  let nodeBMultiaddrTCP

  let nodeC // TCP
  let nodeCMultiaddrTCP

  let nodeD // TCP
  let nodeDMultiaddrTCP

  let nodeE // TCP + WebSockets
  let nodeEMultiaddrTCP
  let nodeEMultiaddrWebSockets

  let nodeF // WebSockets
  let nodeFMultiaddrWebSockets

  let nodeG // TCP + WebRTC Star
  // let nodeGMultiaddrTCP
  let nodeGMultiaddrWebRTCStar

  let nodeH // WebRTC Star
  let nodeHMultiaddrWebRTCStar

  let spawnedNode

  let ss

  before((done) => {
    signalling.start({ port: 24642 }, (err, server) => {
      expect(err).to.not.exist
      ss = server
      done()
    })
  })

  after((done) => {
    ss.stop(done)
  })

  it('create 8 nodes', (done) => {
    map([0, 1, 2, 3, 4, 5, 6, 7], (i, cb) => {
      PeerInfo.create(cb)
    }, (err, infos) => {
      if (err) {
        return done(err)
      }

      infos.forEach((info, i) => {
        // skip nodeF and nodeH
        if (i === 5 || i === 7) {
          return
        }
        info.multiaddr.add(multiaddr('/ip4/0.0.0.0/tcp/0'))
      })

      nodeA = new Node(infos[0], undefined, { mdns: true })
      nodeB = new Node(infos[1], undefined, { mdns: true })
      nodeC = new Node(infos[2])
      nodeD = new Node(infos[3])
      nodeE = new Node(infos[4])
      nodeF = new Node(infos[5])
      nodeG = new Node(infos[6])
      nodeH = new Node(infos[7])

      // add WebSockets to nodeE
      const maddrWS1 = multiaddr('/ip4/127.0.0.1/tcp/25001/ws')
      nodeE.peerInfo.multiaddr.add(maddrWS1)

      nodeEMultiaddrWebSockets = multiaddr(
        nodeE.peerInfo.multiaddrs[1].toString() +
        '/ipfs/' + nodeE.peerInfo.id.toB58String()
      )

      // add WebSockets to nodeF
      const maddrWS2 = multiaddr('/ip4/127.0.0.1/tcp/25002/ws')
      nodeF.peerInfo.multiaddr.add(maddrWS2)

      nodeFMultiaddrWebSockets = multiaddr(
        nodeF.peerInfo.multiaddrs[0].toString() +
        '/ipfs/' + nodeF.peerInfo.id.toB58String()
      )

      // add WebRTC Star to nodeG
      nodeGMultiaddrWebRTCStar = multiaddr(
          '/libp2p-webrtc-star/ip4/127.0.0.1/tcp/24642/ws' +
          '/ipfs/' + nodeG.peerInfo.id.toB58String())
      nodeG.peerInfo.multiaddr.add(nodeGMultiaddrWebRTCStar)

      // add WebRTC Star to nodeH
      nodeHMultiaddrWebRTCStar = multiaddr(
          '/libp2p-webrtc-star/ip4/127.0.0.1/tcp/24642/ws' +
          '/ipfs/' + nodeH.peerInfo.id.toB58String())
      nodeH.peerInfo.multiaddr.add(nodeHMultiaddrWebRTCStar)

      done()
    })
  })

  it('start 8 nodes', (done) => {
    parallel([
      (cb) => nodeA.start(cb),
      (cb) => nodeB.start(cb),
      (cb) => nodeC.start(cb),
      (cb) => nodeD.start(cb),
      (cb) => nodeE.start(cb),
      (cb) => nodeF.start(cb),
      (cb) => nodeG.start(cb),
      (cb) => nodeH.start(cb)
    ], (err) => {
      expect(err).to.not.exist
      expect(nodeA.peerInfo.multiaddrs.length > 1).to.equal(true)
      expect(nodeB.peerInfo.multiaddrs.length > 1).to.equal(true)
      expect(nodeC.peerInfo.multiaddrs.length > 1).to.equal(true)
      expect(nodeD.peerInfo.multiaddrs.length > 1).to.equal(true)
      expect(nodeE.peerInfo.multiaddrs.length > 2).to.equal(true)
      expect(nodeF.peerInfo.multiaddrs.length).to.equal(1)
      expect(nodeG.peerInfo.multiaddrs.length > 2).to.equal(true)
      expect(nodeH.peerInfo.multiaddrs.length).to.equal(1)
      done()
    })
  })

  it('mdns discovery', (done) => {
    nodeA.discovery.once('peer', (peerInfo) => {
      expect(nodeB.peerInfo.id.toB58String())
        .to.eql(peerInfo.id.toB58String())
      done()
    })
  })

  it('extract TCP multiaddr', () => {
    nodeAMultiaddrTCP = multiaddr((
      nodeA.peerInfo.multiaddrs[0].toString() +
      '/ipfs/' + nodeA.peerInfo.id.toB58String()
      ).replace('0.0.0.0', '127.0.0.1')
    )
    nodeBMultiaddrTCP = multiaddr((
      nodeB.peerInfo.multiaddrs[0].toString() +
      '/ipfs/' + nodeB.peerInfo.id.toB58String()
      ).replace('0.0.0.0', '127.0.0.1')

    )
    nodeCMultiaddrTCP = multiaddr((
      nodeC.peerInfo.multiaddrs[0].toString() +
      '/ipfs/' + nodeC.peerInfo.id.toB58String()
      ).replace('0.0.0.0', '127.0.0.1')

    )
    nodeDMultiaddrTCP = multiaddr((
      nodeD.peerInfo.multiaddrs[0].toString() +
      '/ipfs/' + nodeD.peerInfo.id.toB58String()
      ).replace('0.0.0.0', '127.0.0.1')
    )

    // Note: Here is the multiaddrs[1] again because
    // the .replace in swarm switches the order of
    // the TCP and WS addr
    nodeEMultiaddrTCP = multiaddr((
      nodeE.peerInfo.multiaddrs[1].toString() +
      '/ipfs/' + nodeE.peerInfo.id.toB58String()
      ).replace('0.0.0.0', '127.0.0.1')
    )
  })

  it('handle echo proto in 8 nodes', () => {
    function echo (protocol, conn) {
      pull(conn, conn)
    }

    nodeA.handle('/echo/1.0.0', echo)
    nodeB.handle('/echo/1.0.0', echo)
    nodeC.handle('/echo/1.0.0', echo)
    nodeD.handle('/echo/1.0.0', echo)
    nodeE.handle('/echo/1.0.0', echo)
    nodeF.handle('/echo/1.0.0', echo)
    nodeG.handle('/echo/1.0.0', echo)
    nodeH.handle('/echo/1.0.0', echo)
  })

  // General connectivity tests

  it('libp2p.dialByMultiaddr nodeA to nodeB', (done) => {
    nodeA.dialByMultiaddr(nodeBMultiaddrTCP, (err) => {
      expect(err).to.not.exist
      // Some time for Identify to finish
      setTimeout(check, 500)

      function check () {
        parallel([
          (cb) => {
            const peers = nodeA.peerBook.getAll()
            expect(err).to.not.exist
            expect(Object.keys(peers)).to.have.length(1)
            cb()
          },
          (cb) => {
            const peers = nodeB.peerBook.getAll()
            expect(err).to.not.exist
            expect(Object.keys(peers)).to.have.length(1)
            cb()
          }
        ], done)
      }
      // TODO confirm that we got the pubkey through identify
    })
  })

  it('libp2p.dialByMultiaddr on Protocol nodeA to nodeB', (done) => {
    nodeA.dialByMultiaddr(nodeBMultiaddrTCP, '/echo/1.0.0', (err, conn) => {
      expect(err).to.not.exist
      parallel([
        (cb) => {
          const peers = nodeA.peerBook.getAll()
          expect(err).to.not.exist
          expect(Object.keys(peers)).to.have.length(1)
          cb()
        },
        (cb) => {
          const peers = nodeB.peerBook.getAll()
          expect(err).to.not.exist
          expect(Object.keys(peers)).to.have.length(1)
          cb()
        }
      ], () => {
        pull(
          pull.values([new Buffer('hey')]),
          conn,
          pull.collect((err, data) => {
            expect(err).to.not.exist
            expect(data).to.be.eql([new Buffer('hey')])
            done()
          })
        )
      })
    })
  })

  it('libp2p.hangupByMultiaddr nodeA to nodeB', (done) => {
    nodeA.hangUpByMultiaddr(nodeBMultiaddrTCP, (err) => {
      expect(err).to.not.exist
      setTimeout(check, 500)

      function check () {
        parallel([
          (cb) => {
            const peers = nodeA.peerBook.getAll()
            expect(err).to.not.exist
            expect(Object.keys(peers)).to.have.length(0)
            expect(Object.keys(nodeA.swarm.muxedConns)).to.have.length(0)

            cb()
          },
          (cb) => {
            const peers = nodeB.peerBook.getAll()
            expect(err).to.not.exist
            expect(Object.keys(peers)).to.have.length(0)
            expect(Object.keys(nodeB.swarm.muxedConns)).to.have.length(0)
            cb()
          }
        ], done)
      }
    })
  })

  it('libp2p.dialByPeerInfo nodeA to nodeB', (done) => {
    nodeA.dialByPeerInfo(nodeB.peerInfo, (err) => {
      expect(err).to.not.exist
      // Some time for Identify to finish
      setTimeout(check, 500)

      function check () {
        parallel([
          (cb) => {
            const peers = nodeA.peerBook.getAll()
            expect(err).to.not.exist
            expect(Object.keys(peers)).to.have.length(1)
            cb()
          },
          (cb) => {
            const peers = nodeB.peerBook.getAll()
            expect(err).to.not.exist
            expect(Object.keys(peers)).to.have.length(1)
            cb()
          }
        ], done)
      }
      // TODO confirm that we got the pubkey through identify
    })
  })

  it('libp2p.dialByPeerInfo on Protocol nodeA to nodeB', (done) => {
    nodeA.dialByPeerInfo(nodeB.peerInfo, '/echo/1.0.0', (err, conn) => {
      expect(err).to.not.exist
      parallel([
        (cb) => {
          const peers = nodeA.peerBook.getAll()
          expect(err).to.not.exist
          expect(Object.keys(peers)).to.have.length(1)
          cb()
        },
        (cb) => {
          const peers = nodeB.peerBook.getAll()
          expect(err).to.not.exist
          expect(Object.keys(peers)).to.have.length(1)
          cb()
        }
      ], () => {
        pull(
          pull.values([new Buffer('hey')]),
          conn,
          pull.collect((err, data) => {
            expect(err).to.not.exist
            expect(data).to.be.eql([new Buffer('hey')])
            done()
          })
        )
      })
    })
  })

  it('libp2p.hangupByPeerInfo nodeA to nodeB', (done) => {
    nodeA.hangUpByPeerInfo(nodeB.peerInfo, (err) => {
      expect(err).to.not.exist
      setTimeout(check, 500)

      function check () {
        parallel([
          (cb) => {
            const peers = nodeA.peerBook.getAll()
            expect(err).to.not.exist
            expect(Object.keys(peers)).to.have.length(0)
            expect(Object.keys(nodeA.swarm.muxedConns)).to.have.length(0)

            cb()
          },
          (cb) => {
            const peers = nodeB.peerBook.getAll()
            expect(err).to.not.exist
            expect(Object.keys(peers)).to.have.length(0)
            expect(Object.keys(nodeB.swarm.muxedConns)).to.have.length(0)
            cb()
          }
        ], done)
      }
    })
  })

  // NOTE, these dialById only works if a previous dial was made
  // until we have PeerRouting
  it.skip('libp2p.dialById nodeA to nodeB', (done) => {})
  it.skip('libp2p.dialById on Protocol nodeA to nodeB', (done) => {})
  it.skip('libp2p.hangupById nodeA to nodeB', (done) => {})

  it('nodeA dial to nodeC and nodeD', (done) => {
    let count = 0
    const next = () => ++count === 2 ? check() : null

    nodeA.dialByMultiaddr(nodeCMultiaddrTCP, next)
    nodeA.dialByMultiaddr(nodeDMultiaddrTCP, next)

    function check () {
      const peers = nodeA.peerBook.getAll()
      expect(Object.keys(peers)).to.have.length(2)
      done()
    }
  })

  // Multiple transport tests

  it('nodeA dial to nodeE', (done) => {
    nodeA.dialByMultiaddr(nodeEMultiaddrTCP, (err) => {
      expect(err).to.not.exist
      const peers = nodeA.peerBook.getAll()
      expect(Object.keys(peers)).to.have.length(3)
      done()
    })
  })

  // Until https://github.com/libp2p/js-libp2p/issues/46 is resolved
  // Everynode will be able to dial in WebSockets
  it.skip('nodeA fails to dial to nodeF', (done) => {
    nodeA.dialByMultiaddr(nodeFMultiaddrWebSockets, (err) => {
      expect(err).to.exist
      const peers = nodeA.peerBook.getAll()
      expect(Object.keys(peers)).to.have.length(3)
      done()
    })
  })

  it('nodeF fails to dial to nodeA', (done) => {
    nodeF.dialByMultiaddr(nodeAMultiaddrTCP, (err) => {
      expect(err).to.exist
      done()
    })
  })

  it('nodeF dial to nodeE', (done) => {
    nodeF.dialByMultiaddr(nodeEMultiaddrWebSockets, (err) => {
      expect(err).to.not.exist
      done()
    })
  })

  it('nodeG dial to nodeH', (done) => {
    nodeG.dialByMultiaddr(nodeHMultiaddrWebRTCStar, (err) => {
      expect(err).to.not.exist
      done()
    })
  })

  // Turbolence tests

  it('spawn a node in a different process', (done) => {
    const filePath = path.join(__dirname, './spawn-libp2p-node.js')
    spawnedNode = spawn(filePath)

    let spawned = false
    spawnedNode.stdout.on('data', (data) => {
      if (!spawned) {
        spawned = true
        done()
      }
    })
  })

  it('connect nodeA to that node', (done) => {
    const spawnedId = require('./test-data/test-id.json')
    const maddr = multiaddr('/ip4/127.0.0.1/tcp/12345/ipfs/' + spawnedId.id)
    nodeA.dialByMultiaddr(maddr, '/echo/1.0.0', (err, conn) => {
      expect(err).to.not.exist
      const peers = nodeA.peerBook.getAll()

      expect(Object.keys(peers)).to.have.length(4)

      pull(
        pull.values([new Buffer('hey')]),
        conn,
        pull.collect((err, data) => {
          expect(err).to.not.exist
          expect(data).to.be.eql([new Buffer('hey')])
          done()
        })
      )
    })
  })

  it('nodeE ping to nodeF', (done) => {
    nodeE.pingByPeerInfo(nodeF.peerInfo, (err, ping) => {
      expect(err).to.not.exist
      ping.once('ping', (time) => {
        expect(time >= 0).to.be.true
        ping.stop()
        done()
      })
    })
  })

  it('crash that node, make sure nodeA continues going steady', (done) => {
    spawnedNode.kill('SIGKILL')

    setTimeout(check, 5000)

    function check () {
      const peers = nodeA.peerBook.getAll()
      expect(Object.keys(peers)).to.have.length(3)
      done()
    }
  })

  it('stop', (done) => {
    parallel([
      (cb) => nodeA.stop(cb),
      (cb) => nodeB.stop(cb),
      (cb) => nodeC.stop(cb),
      (cb) => nodeD.stop(cb),
      (cb) => nodeE.stop(cb),
      (cb) => nodeF.stop(cb),
      (cb) => nodeG.stop(cb),
      (cb) => nodeH.stop(cb)
    ], done)
  })
})
