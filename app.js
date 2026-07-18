/* ============================================================
   Circle — app.js
   Loaded as a plain deferred script (NOT type="module") on purpose:
   that way, if the Supabase import below ever fails (bad config,
   offline, opened via file:// instead of a server), the rest of
   the page — screen navigation, name entry — keeps working, and
   only the live features (chat/presence/calling) degrade with a
   clear message instead of the whole page silently doing nothing.
   ============================================================ */

(function () {
  const ICE_SERVERS = { iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ]};

  /* ===================== State ===================== */
  let selectedGroup = 'girl';
  let userName = '';
  let userId = '';
  let roomChannel = null;
  let mySignalChannel = null;
  let supabase = null;
  let liveEnabled = false;

  let pc = null;
  let localStream = null;
  let currentCallPeerId = null;
  let currentCallPeerName = '';
  let callState = 'idle';

  /* ===================== Helpers ===================== */
  function $(id) { return document.getElementById(id); }
  function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
  function sanitizeKeyPart(s) { return s.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'guest'; }
  function showToast(msg) {
    const t = $('toast');
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.style.display = 'none', 3500);
  }
  function goTo(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(id).classList.add('active');
  }

  /* ===================== Navigation — works with zero dependencies ===================== */
  function initNavigation() {
    $('enterBtn').addEventListener('click', () => goTo('screen-choice'));
    $('backToWelcome').addEventListener('click', () => goTo('screen-welcome'));
    $('backToChoice').addEventListener('click', () => goTo('screen-choice'));
    document.querySelectorAll('.tilt-card').forEach(card => {
      card.addEventListener('click', () => selectGroup(card.dataset.group));
    });
    $('joinBtn').addEventListener('click', joinRoom);
    $('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
    $('leaveBtn').addEventListener('click', leaveRoom);
    $('sendBtn').addEventListener('click', sendMessage);
    $('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });

    const heroCard = $('heroCard');
    document.addEventListener('mousemove', (e) => {
      if (!$('screen-welcome').classList.contains('active')) return;
      const r = heroCard.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const rx = ((e.clientY - cy) / r.height) * -6;
      const ry = ((e.clientX - cx) / r.width) * 6;
      heroCard.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
    });
    document.addEventListener('mouseleave', () => { heroCard.style.transform = 'rotateX(0) rotateY(0)'; });
  }

  function selectGroup(group) {
    selectedGroup = group;
    const tag = $('groupTag');
    tag.textContent = group === 'girl' ? 'Girls Circle' : 'Boys Circle';
    tag.className = 'tag ' + group;
    goTo('screen-name');
    setTimeout(() => $('nameInput').focus(), 250);
  }

  /* ===================== Join / Leave ===================== */
  async function joinRoom() {
    const input = $('nameInput');
    const errBox = $('nameError');
    const raw = input.value.trim();
    if (!raw) { errBox.textContent = 'Please enter your name.'; return; }
    errBox.textContent = '';

    userName = raw.slice(0, 20);
    userId = sanitizeKeyPart(userName) + '-' + Math.random().toString(36).slice(2, 7);

    $('chatIcon').textContent = selectedGroup === 'girl' ? '👧🏽' : '👦🏽';
    $('chatGroupName').textContent = selectedGroup === 'girl' ? 'Girls Circle' : 'Boys Circle';
    $('chatBody').innerHTML = '<div class="empty-chat">Loading conversation…</div>';

    goTo('screen-room');

    if (liveEnabled) {
      await loadHistory();
      subscribeToRoom();
      subscribeToSignals();
    } else {
      $('chatBody').innerHTML =
        '<div class="empty-chat">Live chat isn\'t connected yet.<br>Add your Supabase keys to js/config.js to turn this on.</div>';
      $('onlineList').innerHTML = '<div class="online-empty">Not connected to Supabase yet — see README.</div>';
    }

    setTimeout(() => $('chatInput').focus(), 250);
  }

  async function leaveRoom() {
    endCall(true);
    if (supabase) {
      if (roomChannel) { await supabase.removeChannel(roomChannel); roomChannel = null; }
      if (mySignalChannel) { await supabase.removeChannel(mySignalChannel); mySignalChannel = null; }
    }
    userId = ''; userName = '';
    goTo('screen-choice');
  }

  window.addEventListener('beforeunload', () => {
    if (!supabase) return;
    if (roomChannel) supabase.removeChannel(roomChannel);
    if (mySignalChannel) supabase.removeChannel(mySignalChannel);
  });

  /* ===================== Chat: history + realtime ===================== */
  async function loadHistory() {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('group_name', selectedGroup)
      .order('created_at', { ascending: true })
      .limit(200);

    const body = $('chatBody');
    if (error || !data || data.length === 0) {
      body.innerHTML = '<div class="empty-chat">No messages yet — say selam to start the conversation 🌟</div>';
      return;
    }
    body.innerHTML = '';
    data.forEach(renderMessage);
    body.scrollTop = body.scrollHeight;
  }

  function renderMessage(row) {
    const body = $('chatBody');
    const empty = body.querySelector('.empty-chat');
    if (empty) empty.remove();
    const div = document.createElement('div');
    div.className = 'msg ' + (row.sender_id === userId ? 'me' : 'friend');
    div.innerHTML = `<span class="sender">${escapeHtml(row.sender_name)}</span>${escapeHtml(row.text)}`;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  async function sendMessage() {
    const input = $('chatInput');
    const text = input.value.trim();
    if (!text || !userId) return;
    if (!liveEnabled) { showToast('Connect Supabase first — see README.'); return; }
    input.value = '';
    const { error } = await supabase.from('messages').insert({
      group_name: selectedGroup, sender_id: userId, sender_name: userName, text
    });
    if (error) showToast('Message failed to send — check your connection.');
  }

  /* ===================== Presence + chat realtime channel ===================== */
  function subscribeToRoom() {
    roomChannel = supabase.channel(`circle-${selectedGroup}`, {
      config: { presence: { key: userId } }
    });

    roomChannel
      .on('presence', { event: 'sync' }, () => renderOnlineList(roomChannel.presenceState()))
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_name=eq.${selectedGroup}` },
        payload => { if (payload.new.sender_id !== userId) renderMessage(payload.new); }
      )
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await roomChannel.track({ name: userName, online_at: new Date().toISOString() });
        }
      });
  }

  function renderOnlineList(state) {
    const list = $('onlineList');
    const people = Object.entries(state)
      .map(([id, metas]) => ({ id, name: metas[0]?.name || 'Someone' }))
      .filter(p => p.id !== userId);

    if (people.length === 0) {
      list.innerHTML = '<div class="online-empty">No one else is online yet — invite a friend to open this page!</div>';
      return;
    }
    list.innerHTML = people.map(p => `
      <div class="person-row">
        <span class="dot"></span>
        <span class="pname">${escapeHtml(p.name)}</span>
        <button class="call-btn" title="Call ${escapeHtml(p.name)}" data-id="${p.id}" data-name="${escapeHtml(p.name)}">📞</button>
      </div>
    `).join('');
    list.querySelectorAll('.call-btn').forEach(btn => {
      btn.addEventListener('click', () => startCall(btn.dataset.id, btn.dataset.name));
    });
  }

  /* ===================== Calling: personal broadcast channel ===================== */
  function subscribeToSignals() {
    mySignalChannel = supabase.channel(`signal-${userId}`);
    mySignalChannel
      .on('broadcast', { event: 'call' }, ({ payload }) => handleSignal(payload))
      .subscribe();
  }

  function sendSignal(targetId, payload) {
    const ch = supabase.channel(`signal-${targetId}`);
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        ch.send({ type: 'broadcast', event: 'call', payload });
        setTimeout(() => supabase.removeChannel(ch), 4000);
      }
    });
  }

  async function handleSignal(m) {
    if (m.type === 'offer') {
      if (callState !== 'idle') { sendSignal(m.from, { type: 'hangup', from: userId }); return; }
      currentCallPeerId = m.from;
      currentCallPeerName = m.fromName;
      callState = 'ringing';
      window._pendingOffer = m.offer;
      showCallOverlay('ringing');
    } else if (m.type === 'answer') {
      if (pc && currentCallPeerId === m.from) {
        await pc.setRemoteDescription(new RTCSessionDescription(m.answer));
        callState = 'in-call';
        showCallOverlay('in-call');
      }
    } else if (m.type === 'candidate') {
      if (pc && m.candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(m.candidate)); } catch (e) {}
      }
    } else if (m.type === 'hangup') {
      if (currentCallPeerId === m.from) {
        showToast(currentCallPeerName + ' ended the call');
        endCall(true);
      }
    }
  }

  function createPeerConnection(remoteId) {
    const p = new RTCPeerConnection(ICE_SERVERS);
    p.onicecandidate = (e) => {
      if (e.candidate) sendSignal(remoteId, { type: 'candidate', from: userId, candidate: e.candidate.toJSON() });
    };
    p.ontrack = (e) => { $('remoteAudio').srcObject = e.streams[0]; };
    return p;
  }

  async function startCall(targetId, targetName) {
    if (!liveEnabled) { showToast('Connect Supabase first — see README.'); return; }
    if (callState !== 'idle') { showToast('Finish your current call first'); return; }
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      showToast('Microphone access is needed to call'); return;
    }
    currentCallPeerId = targetId;
    currentCallPeerName = targetName;
    callState = 'calling';
    showCallOverlay('calling');

    pc = createPeerConnection(targetId);
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal(targetId, { type: 'offer', from: userId, fromName: userName, offer });
  }

  async function acceptCall() {
    const offer = window._pendingOffer;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      showToast('Microphone access is needed to answer'); endCall(true); return;
    }
    pc = createPeerConnection(currentCallPeerId);
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSignal(currentCallPeerId, { type: 'answer', from: userId, answer });
    callState = 'in-call';
    showCallOverlay('in-call');
  }

  function declineCall() {
    if (currentCallPeerId) sendSignal(currentCallPeerId, { type: 'hangup', from: userId });
    endCall(true);
  }

  function endCall(silent) {
    if (!silent && currentCallPeerId) sendSignal(currentCallPeerId, { type: 'hangup', from: userId });
    if (pc) { pc.close(); pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    callState = 'idle';
    currentCallPeerId = null; currentCallPeerName = '';
    $('callOverlay').classList.remove('active');
  }

  function showCallOverlay(state) {
    const overlay = $('callOverlay');
    const letter = $('callAvatarLetter');
    const nameEl = $('callPeerName');
    const statusEl = $('callStatus');
    const actions = $('callActions');
    overlay.classList.add('active');
    letter.textContent = (currentCallPeerName || '?').charAt(0).toUpperCase();
    nameEl.textContent = currentCallPeerName || 'Unknown';
    actions.innerHTML = '';

    if (state === 'calling' || state === 'in-call') {
      statusEl.textContent = state === 'calling' ? 'Calling…' : 'Connected';
      const endBtn = document.createElement('button');
      endBtn.className = 'end-btn'; endBtn.textContent = '✕';
      endBtn.addEventListener('click', () => endCall(false));
      actions.appendChild(endBtn);
    } else if (state === 'ringing') {
      statusEl.textContent = 'Incoming call…';
      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'accept-btn'; acceptBtn.textContent = '✓';
      acceptBtn.addEventListener('click', acceptCall);
      const declineBtn = document.createElement('button');
      declineBtn.className = 'decline-btn'; declineBtn.textContent = '✕';
      declineBtn.addEventListener('click', declineCall);
      actions.appendChild(acceptBtn); actions.appendChild(declineBtn);
    }
  }

  /* ===================== Boot ===================== */
  initNavigation(); // always runs, regardless of what happens below

  (async function initSupabase() {
    try {
      const [{ createClient }, cfg] = await Promise.all([
        import('https://esm.sh/@supabase/supabase-js@2'),
        import('./config.js')
      ]);
      const { SUPABASE_URL, SUPABASE_ANON_KEY } = cfg;
      const looksConfigured = SUPABASE_URL && SUPABASE_ANON_KEY &&
        SUPABASE_URL.startsWith('http') && !SUPABASE_URL.includes('YOUR_SUPABASE');
      if (!looksConfigured) {
        console.warn('[Circle] Supabase keys are still placeholders — live features are off. See README.md.');
        return;
      }
      supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      liveEnabled = true;
    } catch (err) {
      console.warn('[Circle] Could not load Supabase — live features are off.', err);
      // Common cause: opening index.html directly (file://) instead of via a local
      // server. Run `npx serve .` (or similar) from the project folder, or deploy
      // it, and this will resolve itself.
    }
  })();
})();
