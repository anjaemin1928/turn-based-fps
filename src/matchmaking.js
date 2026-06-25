import { db } from './firebase';
import { 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  where, 
  limit, 
  updateDoc, 
  doc, 
  onSnapshot 
} from 'firebase/firestore';

// 1. 대기열(Lobby)에 참가하거나 방을 만듭니다.
export async function findMatch(peerId, onMatchFound) {
  const lobbiesRef = collection(db, 'lobbies');

  // 상태가 'waiting'인 방 하나 찾기
  const q = query(lobbiesRef, where('status', '==', 'waiting'), limit(1));
  const querySnapshot = await getDocs(q);

  if (!querySnapshot.empty) {
    // 1-1. 누군가 만들어둔 방이 있다면 참가 (내가 Guest)
    const lobbyDoc = querySnapshot.docs[0];
    const lobbyId = lobbyDoc.id;
    const hostPeerId = lobbyDoc.data().hostPeerId;

    // 방 상태를 'playing'으로 변경하고 내 peerId 등록
    await updateDoc(doc(db, 'lobbies', lobbyId), {
      status: 'playing',
      guestPeerId: peerId
    });

    console.log("Joined existing lobby:", lobbyId);
    // 호스트의 peerId를 콜백으로 전달하여 연결 시도
    onMatchFound(hostPeerId, false); // false = I am not the host
  } else {
    // 1-2. 방이 없다면 내가 직접 방 생성 (내가 Host)
    const newLobbyRef = await addDoc(lobbiesRef, {
      hostPeerId: peerId,
      guestPeerId: null,
      status: 'waiting',
      createdAt: new Date()
    });

    console.log("Created new lobby:", newLobbyRef.id);

    // 내 방에 누군가 들어오는지 실시간 감시(리스닝)
    const unsubscribe = onSnapshot(doc(db, 'lobbies', newLobbyRef.id), (snapshot) => {
      const data = snapshot.data();
      if (data && data.status === 'playing' && data.guestPeerId) {
        console.log("A guest joined my lobby!");
        unsubscribe(); // 리스닝 종료
        onMatchFound(data.guestPeerId, true); // true = I am the host
      }
    });
  }
}
