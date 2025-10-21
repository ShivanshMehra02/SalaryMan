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
    
    // PeerJS configuration with self-hosted server for Netlify deployment
    this.myPeer = new Peer(sanitizedId, {
      host: process.env.REACT_APP_PEERJS_HOST || 'localhost',
      port: parseInt(process.env.REACT_APP_PEERJS_PORT || '9000'),
      path: '/peerjs',
      secure: true, // Important for Netlify (HTTPS)
      config: {
        iceServers: [
          { urls: ['stun:stun.l.google.com:19302'] },
          { urls: ['stun:stun1.l.google.com:19302'] },
          { urls: ['stun:stun2.l.google.com:19302'] }
        ]
      }
    })
    
    this.network = network
    console.log('userId:', userId)
    console.log('sanitizedId:', sanitizedId)
    
    this.myPeer.on('error', (err) => {
      console.log('PeerJS Error Type:', err.type)
      console.error('PeerJS Error:', err)
    })

    this.myVideo.muted = true
    this.myVideo.playsInline = true
    this.myVideo.autoplay = true

    this.initialize()
  }

  private replaceInvalidId(userId: string) {
    return userId.replace(/[^0-9a-z]/gi, 'G')
  }

  initialize() {
    this.myPeer.on('call', (call) => {
      if (!this.onCalledPeers.has(call.peer)) {
        // Ensure myStream exists before answering
        if (!this.myStream) {
          console.warn('Received call but myStream is not initialized')
          call.close()
          return
        }
        
        call.answer(this.myStream)
        const video = document.createElement('video')
        video.autoplay = true
        video.playsInline = true
        
        this.onCalledPeers.set(call.peer, { call, video })

        call.on('stream', (userVideoStream) => {
          this.addVideoStream(video, userVideoStream)
        })
        
        call.on('error', (err) => {
          console.error('Call error from peer:', call.peer, err)
        })
        
        call.on('close', () => {
          console.log('Call closed with peer:', call.peer)
        })
      }
    })
    
    this.myPeer.on('open', (id) => {
      console.log('PeerJS connection opened with ID:', id)
    })
  }

  checkPreviousPermission() {
    const permissionName = 'microphone' as PermissionName
    navigator.permissions?.query({ name: permissionName }).then((result) => {
      if (result.state === 'granted') this.getUserMedia(false)
    })
  }

  getUserMedia(alertOnError = true) {
    const constraints = {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    }

    navigator.mediaDevices
      ?.getUserMedia(constraints)
      .then((stream) => {
        this.myStream = stream
        this.addVideoStream(this.myVideo, this.myStream)
        this.setUpButtons()
        store.dispatch(setVideoConnected(true))
        this.network.videoConnected()
        console.log('Media stream initialized successfully')
      })
      .catch((error) => {
        console.error('getUserMedia error:', error)
        if (alertOnError) {
          window.alert(
            `Failed to access media devices: ${error.name} - ${error.message}. ` +
            'Please check your browser permissions and device settings.'
          )
        }
      })
  }

  connectToNewUser(userId: string) {
    if (!this.myStream) {
      console.warn('Cannot connect to new user: myStream is not initialized')
      return
    }

    const sanitizedId = this.replaceInvalidId(userId)
    if (!this.peers.has(sanitizedId)) {
      console.log('Calling peer:', sanitizedId)
      try {
        const call = this.myPeer.call(sanitizedId, this.myStream)
        const video = document.createElement('video')
        video.autoplay = true
        video.playsInline = true
        
        this.peers.set(sanitizedId, { call, video })

        call.on('stream', (userVideoStream) => {
          this.addVideoStream(video, userVideoStream)
        })
        
        call.on('error', (err) => {
          console.error('Call error to peer:', sanitizedId, err)
        })
        
        call.on('close', () => {
          console.log('Call closed to peer:', sanitizedId)
          this.deleteVideoStream(userId)
        })
      } catch (error) {
        console.error('Error initiating call:', error)
      }
    }
  }

  addVideoStream(video: HTMLVideoElement, stream: MediaStream) {
    video.srcObject = stream
    video.playsInline = true
    video.autoplay = true
    
    video.addEventListener('loadedmetadata', () => {
      console.log('Video metadata loaded')
      video.play().catch((err) => {
        console.error('Error playing video:', err)
      })
    })
    
    video.addEventListener('error', (err) => {
      console.error('Video element error:', err)
    })
    
    if (this.videoGrid) this.videoGrid.append(video)
  }

  deleteVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    if (this.peers.has(sanitizedId)) {
      const peer = this.peers.get(sanitizedId)
      peer?.call.close()
      peer?.video.remove()
      this.peers.delete(sanitizedId)
      console.log('Deleted video stream for peer:', sanitizedId)
    }
  }

  deleteOnCalledVideoStream(userId: string) {
    const sanitizedId = this.replaceInvalidId(userId)
    if (this.onCalledPeers.has(sanitizedId)) {
      const onCalledPeer = this.onCalledPeers.get(sanitizedId)
      onCalledPeer?.call.close()
      onCalledPeer?.video.remove()
      this.onCalledPeers.delete(sanitizedId)
      console.log('Deleted on-called video stream for peer:', sanitizedId)
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
