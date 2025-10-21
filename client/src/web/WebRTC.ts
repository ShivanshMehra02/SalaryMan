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
    
    // Enhanced PeerJS config for cross-browser compatibility
    this.myPeer = new Peer(sanitizedId, {
      config: {
        iceServers: [
          { urls: ['stun:stun.l.google.com:19302'] },
          { urls: ['stun:stun1.l.google.com:19302'] },
          { urls: ['stun2.l.google.com:19302'] },
          { urls: ['stun:stun3.l.google.com:19302'] },
          { urls: ['stun:stun4.l.google.com:19302'] }
        ]
      }
    })
    
    this.network = network
    console.log('userId:', userId)
    console.log('sanitizedId:', sanitizedId)
    
    this.myPeer.on('error', (err) => {
      console.log('PeerJS Error:', err.type)
      console.error(err)
    })

    this.myVideo.muted = true
    this.myVideo.autoplay = true
    this.myVideo.playsInline = true
    this.myVideo.setAttribute('playsinline', 'true')

    this.initialize()
  }

  private replaceInvalidId(userId: string) {
    return userId.replace(/[^0-9a-z]/gi, 'G')
  }

  initialize() {
    this.myPeer.on('call', (call) => {
      if (!this.onCalledPeers.has(call.peer)) {
        if (!this.myStream) {
          console.warn('No stream available to answer call')
          call.close()
          return
        }

        call.answer(this.myStream)
        const video = document.createElement('video')
        video.autoplay = true
        video.playsInline = true
        video.setAttribute('playsinline', 'true')
        
        this.onCalledPeers.set(call.peer, { call, video })

        call.on('stream', (userVideoStream) => {
          this.addVideoStream(video, userVideoStream)
        })

        call.on('error', (err) => {
          console.error('Call error:', err)
        })
      }
    })

    this.myPeer.on('open', (id) => {
      console.log('PeerJS opened with ID:', id)
    })
  }

  checkPreviousPermission() {
    const permissionName = 'microphone' as PermissionName
    navigator.permissions?.query({ name: permissionName }).then((result) => {
      if (result.state === 'granted') this.getUserMedia(false)
    })
  }

  getUserMedia(alertOnError = true) {
    const constraints: any = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    }

    // Try with video first, fallback to audio only
    constraints.video = {
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }

    navigator.mediaDevices
      ?.getUserMedia(constraints)
      .then((stream) => {
        this.myStream = stream
        this.addVideoStream(this.myVideo, this.myStream)
        this.setUpButtons()
        store.dispatch(setVideoConnected(true))
        this.network.videoConnected()
        console.log('Media stream initialized with video and audio')
      })
      .catch((error) => {
        console.warn('getUserMedia with video failed, trying audio only:', error)
        
        // Fallback: try audio only
        navigator.mediaDevices
          ?.getUserMedia({
            video: false,
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          })
          .then((stream) => {
            this.myStream = stream
            this.addVideoStream(this.myVideo, this.myStream)
            this.setUpButtons()
            store.dispatch(setVideoConnected(true))
            this.network.videoConnected()
            console.log('Media stream initialized with audio only')
          })
          .catch((audioError) => {
            console.error('Failed to get audio:', audioError)
            if (alertOnError) {
              window.alert(
                'Unable to access microphone or camera. Please check your browser permissions and device.'
              )
            }
          })
      })
  }

  connectToNewUser(userId: string) {
    if (!this.myStream) {
      console.warn('myStream not initialized')
      return
    }

    const sanitizedId = this.replaceInvalidId(userId)
    if (!this.peers.has(sanitizedId)) {
      console.log('Calling user:', sanitizedId)
      try {
        const call = this.myPeer.call(sanitizedId, this.myStream)
        const video = document.createElement('video')
        video.autoplay = true
        video.playsInline = true
        video.setAttribute('playsinline', 'true')
        
        this.peers.set(sanitizedId, { call, video })

        call.on('stream', (userVideoStream) => {
          this.addVideoStream(video, userVideoStream)
        })

        call.on('error', (err) => {
          console.error('Call error:', err)
          this.deleteVideoStream(userId)
        })

        call.on('close', () => {
          console.log('Call closed')
          this.deleteVideoStream(userId)
        })
      } catch (error) {
        console.error('Error calling user:', error)
      }
    }
  }

  addVideoStream(video: HTMLVideoElement, stream: MediaStream) {
    video.srcObject = stream
    video.playsInline = true
    video.autoplay = true
    video.setAttribute('playsinline', 'true')
    
    const playPromise = video.play()
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          console.log('Video playing successfully')
        })
        .catch((error) => {
          console.error('Video play error:', error)
        })
    }

    if (this.videoGrid) this.videoGrid.append(video)
  }

  deleteVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    if (this.peers.has(sanitizedId)) {
      const peer = this.peers.get(sanitizedId)
      peer?.call.close()
      peer?.video.remove()
      this.peers.delete(sanitizedId)
    }
  }

  deleteOnCalledVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    if (this.onCalledPeers.has(sanitizedId)) {
      const onCalledPeer = this.onCalledPeers.get(sanitizedId)
      onCalledPeer?.call.close()
      onCalledPeer?.video.remove()
      this.onCalledPeers.delete(sanitizedId)
    }
  }

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
