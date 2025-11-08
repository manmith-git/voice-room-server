// web-client/client.js — with STUN/TURN + Mute/Unmute

const SIGNALING_SERVER = window.location.origin;
const socket = io(SIGNALING_SERVER);

let pc = null;
let localStream = null;
let roomCode = null;
let mySocketId = null;
let isMuted = false; // 🔇 Track mute state

// ===== SOCKET EVENTS =====
socket.on('connect', () => {
  mySocketId = socket.id;
  console.log('Connected to signaling server:', mySocketId);
});

socket.on('members', (members) => {
  document.getElementById('members').innerText = 'Members: ' + members.join(', ');
});

socket.on('signal', async ({ from, data }) => {
  if (!pc) return;

  if (data.type === 'offer') {
    await pc.setRemoteDescription(new RTCSessionDescription(data));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('signal', { room: roomCode, to: from, data: pc.localDescription });

  } else if (data.type === 'answer') {
    await pc.setRemoteDescription(new RTCSessionDescription(data));

  } else if (data.candidate) {
    try { 
      await pc.addIceCandidate(data.candidate); 
    } catch (e) { 
      console.warn('Error adding ICE candidate:', e); 
    }

  } else if (data.type === 'leave') {
    console.log('Peer left the room');
    if (pc) {
      pc.close();
      pc = null;
    }
  }
});

// ====== CREATE PEER CONNECTION ======
async function createPeer(asInitiator = false) {
  pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: 'turn:relay1.expressturn.com:3478',
        username: 'efree',
        credential: 'efree'
      }
    ]
  });

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      socket.emit('signal', { room: roomCode, data: { candidate: ev.candidate } });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('Connection state:', pc.connectionState);
  };

  pc.ontrack = (ev) => {
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.srcObject = ev.streams[0];
    document.getElementById('audio').appendChild(audio);
  };

  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  // Enable mute button after audio is active
  const muteBtn = document.getElementById('muteBtn');
  muteBtn.disabled = false;

  return pc;
}

// ====== ROOM ACTIONS ======
document.getElementById('create').onclick = async () => {
  const name = prompt('Your name for the room?') || 'creator';
  socket.emit('create-room', name, (res) => {
    if (res.ok) {
      roomCode = res.room;
      document.getElementById('room').value = roomCode;
      alert('Room created: ' + roomCode + '\nShare it with others');
    }
  });
};

document.getElementById('join').onclick = async () => {
  const room = document.getElementById('room').value.trim();
  const name = document.getElementById('name').value.trim() || 'web';
  if (!room) return alert('Enter room code');

  socket.emit('join-room', { room, name }, async (res) => {
    if (!res.ok) return alert(res.error || 'join failed');
    roomCode = room;

    await createPeer(true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { room: roomCode, data: offer });
  });
};

document.getElementById('leave').onclick = () => {
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (roomCode) socket.emit('signal', { room: roomCode, data: { type: 'leave' } });
  roomCode = null;

  const muteBtn = document.getElementById('muteBtn');
  muteBtn.disabled = true;
  muteBtn.textContent = 'Mute 🔇';
  isMuted = false;
};

// ====== MUTE / UNMUTE BUTTON ======
const muteBtn = document.getElementById('muteBtn');

muteBtn.onclick = () => {
  if (!localStream) return;

  const audioTrack = localStream.getAudioTracks()[0];
  audioTrack.enabled = !audioTrack.enabled;
  isMuted = !audioTrack.enabled;

  muteBtn.textContent = isMuted ? 'Unmute 🎤' : 'Mute 🔇';
  muteBtn.style.backgroundColor = isMuted ? '#e74c3c' : '#2ecc71';

  console.log(isMuted ? '🔇 Mic muted' : '🎤 Mic unmuted');

  // Optional: let others know you muted
  socket.emit('mute-toggle', { room: roomCode, muted: isMuted });
};

// Receive mute events from others (optional)
socket.on('user-muted', ({ muted, from }) => {
  console.log(`User ${from} ${muted ? 'muted' : 'unmuted'} their mic`);
});
