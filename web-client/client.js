const SIGNALING_SERVER = window.location.origin;
const socket = io(SIGNALING_SERVER);

let pc = null;
let localStream = null;
let roomCode = null;
let mySocketId = null;

socket.on('connect', () => { mySocketId = socket.id; console.log('connected', mySocketId); });

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
    try { await pc.addIceCandidate(data.candidate); } catch(e){ console.warn(e); }
  }
});

async function createPeer(asInitiator = false) {
  const pc = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }, // free Google STUN
    {
      urls: 'turn:relay1.expressturn.com:3478', // free public TURN relay
      username: 'efree',
      credential: 'efree'
    }
  ]
});

  pc.onicecandidate = (ev) => { if (ev.candidate) socket.emit('signal', { room: roomCode, data: { candidate: ev.candidate } }); };
  pc.ontrack = (ev) => {
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.srcObject = ev.streams[0];
    document.getElementById('audio').appendChild(audio);
  };
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  return pc;
}

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
    // create peer and create offer
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
};