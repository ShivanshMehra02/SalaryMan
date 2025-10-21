import Peer from 'peerjs'
import Network from '../services/Network'
import store from '../stores'
import { setVideoConnected } from '../stores/UserStore'

export default class WebRTC {
  private myPeer: Peer
  private peers = new Map<string, { call: Peer.MediaConnection; video: HTMLVideoElement }>()
  private onCalledPeers = new Map<string, { call: Peer.MediaConnection; video: HTMLVideoElement }>()
  private videoGrid?: HTMLElement | null
  private buttonGrid?: HTMLElement | null
  private myVideo?: HTMLVideoElement
  private myStream?: MediaStream
  private network: Network

  constructor(userId: string, network: Network) {
    this.network = network

    const sanitizedId = this.replaceInvalidId(userId)
    this.myPeer = new Peer(sanitizedId)

    this.myPeer.on('error', (err) => {
      console.error('PeerJS error:', err)
    })

    // Only initialize browser stuff if running in a browser
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      this.videoGrid = document.querySelector('.video-grid')
      this.buttonGrid = document.querySelector('.button-grid')
      this.myVideo = document.createElement('video')
      this.myVideo.muted = true

      this.initialize()
      this.createStartButton()
    } else {
      console.log('⚠️ WebRTC initialized in non-browser environment (skipped DOM setup).')
    }
  }

  private replaceInvalidId(userId: string) {
    return userId.replace(/[^0-9a-z]/gi, 'G')
  }

  private initialize() {
    this.myPeer.on('call', (call) => {
      if (!this.onCalledPeers.has(call.peer)) {
        call.answer(this.myStream)
        const video = document.createElement('video')
        this.onCalledPeers.set(call.peer, { call, video })

        call.on('stream', (userVideoStream) => {
          this.addVideoStream(video, userVideoStream)
        })
      }
    })
  }

  // Request camera/microphone access
  getUserMedia(alertOnError = true) {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      console.warn('navigator.mediaDevices not available in this environment.')
      return
    }

    const isSecure = typeof window !== 'undefined' && window.isSecureContext
    if (!isSecure) {
      alert('⚠️ Your site must be served over HTTPS for camera/mic to work.')
      return
    }

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        console.log('🎥 Media stream acquired.')
        this.myStream = stream

        if (this.myVideo) {
          this.addVideoStream(this.myVideo, this.myStream)
        }

        this.setUpButtons()
        store.dispatch(setVideoConnected(true))
        this.network.videoConnected()
      })
      .catch((error) => {
        console.error('getUserMedia error:', error)
        if (alertOnError) {
          if (error.name === 'NotAllowedError') {
            window.alert('Please allow access to your camera and microphone.')
          } else if (error.name === 'NotFoundError') {
            window.alert('No camera or microphone found.')
          } else {
            window.alert('No webcam or microphone found, or permission is blocked.')
          }
        }
      })
  }

  // Call another peer
  connectToNewUser(userId: string) {
    if (this.myStream) {
      const sanitizedId = this.replaceInvalidId(userId)
      if (!this.peers.has(sanitizedId)) {
        console.log('📞 Calling', sanitizedId)
        const call = this.myPeer.call(sanitizedId, this.myStream)
        const video = document.createElement('video')
        this.peers.set(sanitizedId, { call, video })

        call.on('stream', (userVideoStream) => {
          this.addVideoStream(video, userVideoStream)
        })
      }
    } else {
      console.warn('Attempted to call before media stream was ready.')
    }
  }

  private addVideoStream(video: HTMLVideoElement, stream: MediaStream) {
    video.srcObject = stream
    video.playsInline = true
    video.addEventListener('loadedmetadata', () => video.play())
    if (this.videoGrid) this.videoGrid.append(video)
  }

  deleteVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    const peer = this.peers.get(sanitizedId)
    if (peer) {
      peer.call.close()
      peer.video.remove()
      this.peers.delete(sanitizedId)
    }
  }

  deleteOnCalledVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    const onCalledPeer = this.onCalledPeers.get(sanitizedId)
    if (onCalledPeer) {
      onCalledPeer.call.close()
      onCalledPeer.video.remove()
      this.onCalledPeers.delete(sanitizedId)
    }
  }

  private setUpButtons() {
    if (!this.buttonGrid || !this.myStream) return
    this.buttonGrid.innerHTML = ''

    const audioButton = document.createElement('button')
    audioButton.innerText = 'Mute'
    audioButton.addEventListener('click', () => {
      const audioTrack = this.myStream!.getAudioTracks()[0]
      audioTrack.enabled = !audioTrack.enabled
      audioButton.innerText = audioTrack.enabled ? 'Mute' : 'Unmute'
    })

    const videoButton = document.createElement('button')
    videoButton.innerText = 'Video Off'
    videoButton.addEventListener('click', () => {
      const videoTrack = this.myStream!.getVideoTracks()[0]
      videoTrack.enabled = !videoTrack.enabled
      videoButton.innerText = videoTrack.enabled ? 'Video Off' : 'Video On'
    })

    this.buttonGrid.append(audioButton, videoButton)
  }

  private createStartButton() {
    if (typeof document === 'undefined') return
    if (!document.querySelector('#start-video')) {
      const button = document.createElement('button')
      button.id = 'start-video'
      button.innerText = '🎥 Start Camera'
      button.style.margin = '10px'
      button.addEventListener('click', () => {
        this.getUserMedia(true)
        button.remove()
      })
      document.body.prepend(button)
    }
  }
}
