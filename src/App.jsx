import { useState, useRef, useEffect } from 'react'
import { Crosshair } from 'lucide-react'
import Peer from 'peerjs'
import { findMatch } from './matchmaking'
import Game from './Game'

function App() {
  const [gameState, setGameState] = useState('menu'); // 'menu', 'matchmaking', 'playing'
  const [peerId, setPeerId] = useState(null);
  const [connection, setConnection] = useState(null);
  const [isHost, setIsHost] = useState(false);
  
  const peerRef = useRef(null);

  const startMatchmaking = () => {
    setGameState('matchmaking');
    
    // PeerJS 초기화
    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', (id) => {
      console.log('My peer ID is: ' + id);
      setPeerId(id);

      // Firestore 매칭 로직 호출
      findMatch(id, (opponentPeerId, amIHost) => {
        setIsHost(amIHost);
        
        if (amIHost) {
          // 내가 호스트면 방에 들어온 게스트의 연결을 기다림 (matchmaking.js에서 onMatchFound 호출 시점엔 이미 누군가 들어왔음)
          // 하지만 사실 PeerJS 관점에서는 게스트가 나한테 connect()를 걸어오기를 기다리는 on('connection') 이벤트가 필요함.
          // 여기서 onMatchFound가 트리거되었다는 건 게스트가 방에 들어왔다는 뜻. 이제 게스트가 연결할 때까지 대기.
        } else {
          // 내가 게스트면 호스트에게 연결 시도
          console.log('Connecting to host:', opponentPeerId);
          const conn = peer.connect(opponentPeerId);
          setupConnection(conn);
        }
      });
    });

    // 호스트일 때 상대방이 나에게 연결해오면 처리
    peer.on('connection', (conn) => {
      console.log('An opponent connected to me!');
      setupConnection(conn);
    });

    peer.on('error', (err) => {
      console.error('PeerJS error:', err);
      setGameState('menu');
      alert('매칭 중 오류가 발생했습니다: ' + err.message);
    });
  };

  const setupConnection = (conn) => {
    conn.on('open', () => {
      console.log('Data connection opened!');
      setConnection(conn);
      setGameState('playing');
    });

    conn.on('close', () => {
      alert('상대방과의 연결이 끊어졌습니다.');
      setGameState('menu');
      setConnection(null);
    });
  };

  const cancelMatchmaking = () => {
    if (peerRef.current) {
      peerRef.current.destroy();
    }
    setGameState('menu');
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      {gameState === 'menu' && (
        <div className="glass-panel p-10 max-w-md w-full text-center flex flex-col items-center gap-8">
          <div className="flex items-center justify-center gap-3">
            <Crosshair className="w-12 h-12 text-neon-blue" />
            <h1 className="text-4xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-neon-blue to-purple-500">
              BATTLE
            </h1>
          </div>
          
          <p className="text-slate-300 text-lg">
            1v1 Turn-Based Tactical FPS
          </p>
          
          <div className="w-full flex flex-col gap-4 mt-4">
            <button 
              onClick={startMatchmaking}
              className="glass-button-primary w-full"
            >
              Find Match
            </button>
            <button className="glass-button bg-slate-700/50 hover:bg-slate-600/50 w-full border-slate-600">
              Settings
            </button>
          </div>
        </div>
      )}

      {gameState === 'matchmaking' && (
        <div className="glass-panel p-10 max-w-md w-full text-center flex flex-col items-center gap-6">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-neon-blue"></div>
          <h2 className="text-2xl font-bold text-white">Searching for opponent...</h2>
          <p className="text-slate-400">Connecting to Firebase Signaling Server</p>
          <button 
            onClick={cancelMatchmaking}
            className="glass-button-danger mt-4"
          >
            Cancel
          </button>
        </div>
      )}

      {gameState === 'playing' && connection && (
        <Game conn={connection} isHost={isHost} />
      )}
    </div>
  )
}

export default App
