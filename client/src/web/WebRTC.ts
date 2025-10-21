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

    // mute your own video stream
    this.myVideo.muted = true

    this.initialize()
  }

  // Replace invalid PeerJS IDs
  private replaceInvalidId(userId: string) {
    return userId.replace(/[^0-9a-z]/gi, 'G')
  }

  initialize() {
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

  // ✅ Simplified + safe fix for permissions
  checkPreviousPermission() {
    this.getUserMedia(false)
  }

  // ✅ Updated getUserMedia with better error handling + retry UI
  getUserMedia(alertOnError = true) {
    navigator.mediaDevices
      ?.getUserMedia({
        video: true,
        audio: true,
      })
      .then((stream) => {
        this.myStream = stream
        this.addVideoStream(this.myVideo, this.myStream)
        this.setUpButtons()
        store.dispatch(setVideoConnected(true))
        this.network.videoConnected()
      })
      .catch((error) => {
        console.error('getUserMedia error:', error)
        if (!alertOnError) return

        let message = ''
        switch (error.name) {
          case 'NotAllowedError':
            message =
              'Camera or microphone access was denied. Please allow permissions and try again.'
            break
          case 'NotFoundError':
            message = 'No camera or microphone detected on this device.'
            break
          case 'NotReadableError':
            message = 'Camera or microphone is already in use by another app.'
            break
          case 'OverconstrainedError':
            message = 'Device does not meet the required media constraints.'
            break
          default:
            message =
              'Unable to access camera or microphone. Please check your browser permissions.'
        }

        this.showInlineError(message)
      })
  }

  // ✅ Inline permission alert UI
  private showInlineError(message: string) {
    // remove existing alert if any
    const existing = document.querySelector('.media-error-box')
    if (existing) existing.remove()

    const box = document.createElement('div')
    box.className =
      'media-error-box fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-4 py-3 rounded-lg shadow-lg z-50 flex flex-col items-center gap-2'
    box.style.fontFamily = 'sans-serif'
    box.style.maxWidth = '90%'
    box.style.textAlign = 'center'

    const text = document.createElement('div')
    text.innerText = message
    box.appendChild(text)

    const retry = document.createElement('button')
    retry.innerText = 'Retry Camera Access'
    retry.style.background = '#fff'
    retry.style.color = '#000'
    retry.style.border = 'none'
    retry.style.padding = '6px 12px'
    retry.style.borderRadius = '6px'
    retry.style.cursor = 'pointer'
    retry.onclick = () => {
      box.remove()
      this.getUserMedia(false)
    }

    box.appendChild(retry)
    document.body.appendChild(box)
  }

  // Connect to a new user
  connectToNewUser(userId: string) {
    if (this.myStream) {
      const sanitizedId = this.replaceInvalidId(userId)
      if (!this.peers.has(sanitizedId)) {
        console.log('calling', sanitizedId)
        const call = this.myPeer.call(sanitizedId, this.myStream)
        const video = document.createElement('video')
        this.peers.set(sanitizedId, { call, video })

        call.on('stream', (userVideoStream) => {
          this.addVideoStream(video, userVideoStream)
        })
      }
    }
  }

  // Add new video stream
  addVideoStream(video: HTMLVideoElement, stream: MediaStream) {
    video.srcObject = stream
    video.playsInline = true
    video.addEventListener('loadedmetadata', () => {
      video.play()
    })
    if (this.videoGrid) this.videoGrid.append(video)
  }

  // Remove video stream (when host)
  deleteVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    if (this.peers.has(sanitizedId)) {
      const peer = this.peers.get(sanitizedId)
      peer?.call.close()
      peer?.video.remove()
      this.peers.delete(sanitizedId)
    }
  }

  // Remove video stream (when guest)
  deleteOnCalledVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    if (this.onCalledPeers.has(sanitizedId)) {
      const onCalledPeer = this.onCalledPeers.get(sanitizedId)
      onCalledPeer?.call.close()
      onCalledPeer?.video.remove()
      this.onCalledPeers.delete(sanitizedId)
    }
  }

  // Set up mute/unmute and video toggle buttons
  setUpButtons() {
    const audioButton = document.createElement('button')
    audioButton.innerText = 'Mute'
    audioButton.addEventListener('click', () => {
      if (this.myStream) {
        const audioTrack = this.myStream.getAudioTracks()[0]
        if (audioTrack.enabled) {
          audioTrack.enabled = false
          audioButton.innerText = 'Unmute'
        } else {
          audioTrack.enabled = true
          audioButton.innerText = 'Mute'
        }
      }
    })

    const videoButton = document.createElement('button')
    videoButton.innerText = 'Video off'
    videoButton.addEventListener('click', () => {
      if (this.myStream) {
        const videoTrack = this.myStream.getVideoTracks()[0]
        if (videoTrack.enabled) {
          videoTrack.enabled = false
          videoButton.innerText = 'Video on'
        } else {
          videoTrack.enabled = true
          videoButton.innerText = 'Video off'
        }
      }
    })

    this.buttonGrid?.append(audioButton)
    this.buttonGrid?.append(videoButton)
  }
}
