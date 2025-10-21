import Peer from 'peerjs'
import Network from '../services/Network'
import store from '../stores'
import { setVideoConnected } from '../stores/UserStore'

export default class WebRTC {
  private myPeer: Peer
  private peers = new Map<string, { call: Peer.MediaConnection; video: HTMLVideoElement }>()
  private onCalledPeers = new Map<string, { call: Peer.MediaConnection; video: HTMLVideoElement }>()
  private videoGrid = document.querySelector('.video-grid')
  private buttonGrid = document.querySelector('.button-grid')
  private myVideo = document.createElement('video')
  private myStream?: MediaStream
  private network: Network

  constructor(userId: string, network: Network) {
    const sanitizedId = this.replaceInvalidId(userId)
    this.myPeer = new Peer(sanitizedId)
    this.network = network
    console.log('userId:', userId)
    console.log('sanitizedId:', sanitizedId)
    this.myPeer.on('error', (err) => {
      console.log(err.type)
      console.error(err)
    })

    // mute your own video stream (you don't want to hear yourself)
    this.myVideo.muted = true

    // initialize PeerJS listeners
    this.initialize()
  }

  // replace invalid peer ID characters
  private replaceInvalidId(userId: string) {
    return userId.replace(/[^0-9a-z]/gi, 'G')
  }

  initialize() {
    this.myPeer.on('call', (call) => {
      // ✅ wait until local stream is ready before answering
      const waitForStream = () => {
        if (this.myStream) {
          call.answer(this.myStream)
          const video = document.createElement('video')
          this.onCalledPeers.set(call.peer, { call, video })

          call.on('stream', (userVideoStream) => {
            this.addVideoStream(video, userVideoStream)
          })
        } else {
          console.log('Stream not ready yet, waiting...')
          setTimeout(waitForStream, 500)
        }
      }
      waitForStream()
    })
  }

  // optional permission check (only logs, doesn’t block)
  checkPreviousPermission() {
    if (!navigator.permissions) return
    navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((result) => {
        if (result.state === 'granted') this.getUserMedia(false)
      })
      .catch(() => console.log('Permission API not supported'))
  }

  getUserMedia(alertOnError = true) {
    // ask the browser for mic + camera
    navigator.mediaDevices
      ?.getUserMedia({
        video: true,
        audio: true,
      })
      .then((stream) => {
        if (!stream.getAudioTracks().length) {
          console.warn('⚠️ No audio track in stream.')
        }
        this.myStream = stream
        this.addVideoStream(this.myVideo, this.myStream)
        store.dispatch(setVideoConnected(true))
        this.network.videoConnected()
        this.setUpButtons()
      })
      .catch((error) => {
        console.error('getUserMedia error:', error)
        if (alertOnError) window.alert('No webcam or microphone found, or permission is blocked.')
      })
  }

  // call another peer
  connectToNewUser(userId: string) {
    if (this.myStream) {
      const sanitizedId = this.replaceInvalidId(userId)
      if (!this.peers.has(sanitizedId)) {
        console.log('calling', sanitizedId)
        console.log(
          'Local tracks:',
          this.myStream.getTracks().map((t) => `${t.kind}:${t.readyState}`)
        )
        const call = this.myPeer.call(sanitizedId, this.myStream)
        const video = document.createElement('video')
        this.peers.set(sanitizedId, { call, video })

        call.on('stream', (userVideoStream) => {
          this.addVideoStream(video, userVideoStream)
        })
      }
    } else {
      console.warn('No local media stream found when trying to call user.')
    }
  }

  // add video stream to UI
  addVideoStream(video: HTMLVideoElement, stream: MediaStream) {
    video.srcObject = stream
    video.autoplay = true
    video.playsInline = true
    video.muted = video === this.myVideo // mute only local self-view
    video.addEventListener('loadedmetadata', () => {
      video.play().catch((err) => console.warn('Autoplay blocked:', err))
    })
    if (this.videoGrid) this.videoGrid.append(video)
  }

  // remove stream when we are the host
  deleteVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    if (this.peers.has(sanitizedId)) {
      const peer = this.peers.get(sanitizedId)
      peer?.call.close()
      peer?.video.remove()
      this.peers.delete(sanitizedId)
    }
  }

  // remove stream when we are the guest
  deleteOnCalledVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    if (this.onCalledPeers.has(sanitizedId)) {
      const onCalledPeer = this.onCalledPeers.get(sanitizedId)
      onCalledPeer?.call.close()
      onCalledPeer?.video.remove()
      this.onCalledPeers.delete(sanitizedId)
    }
  }

  // mute/unmute and video on/off buttons
  setUpButtons() {
    const audioButton = document.createElement('button')
    audioButton.innerText = 'Mute'
    audioButton.addEventListener('click', () => {
      if (this.myStream) {
        const audioTrack = this.myStream.getAudioTracks()[0]
        if (audioTrack) {
          audioTrack.enabled = !audioTrack.enabled
          audioButton.innerText = audioTrack.enabled ? 'Mute' : 'Unmute'
        }
      }
    })

    const videoButton = document.createElement('button')
    videoButton.innerText = 'Video off'
    videoButton.addEventListener('click', () => {
      if (this.myStream) {
        const videoTrack = this.myStream.getVideoTracks()[0]
        if (videoTrack) {
          videoTrack.enabled = !videoTrack.enabled
          videoButton.innerText = videoTrack.enabled ? 'Video off' : 'Video on'
        }
      }
    })

    this.buttonGrid?.append(audioButton)
    this.buttonGrid?.append(videoButton)
  }
}
