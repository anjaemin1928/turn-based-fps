import { useState, useRef, useEffect } from 'react'
import { Crosshair, LogIn, Dices } from 'lucide-react'
import Peer from 'peerjs'
import { auth, googleProvider, db } from './firebase'
import { signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { findMatch } from './matchmaking'
import Game from './Game'

const ADJECTIVES = ["멋진", "강력한", "귀여운", "화난", "배고픈", "빛나는", "어둠의", "빠른", "느린", "전설의"];
const NOUNS = ["강아지", "고양이", "호랑이", "사자", "토끼", "돼지", "독수리", "용", "거북이", "늑대"];

function App() {
  const [gameState, setGameState] = useState('loading'); // loading, login, create_profile, menu, matchmaking, playing
  const [userProfile, setUserProfile] = useState(null);
  const [generatedName, setGeneratedName] = useState("");
  
  // PeerJS states
  const [peerId, setPeerId] = useState(null);
  const [connection, setConnection] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const peerRef = useRef(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // 유저가 로그인함 -> Firestore에서 프로필 확인
        const userDocRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userDocRef);

        if (userSnap.exists()) {
          // 기존 유저
          setUserProfile(userSnap.data());
          setGameState('menu');
        } else {
          // 신규 유저
          generateRandomName();
          setGameState('create_profile');
        }
      } else {
        // 로그인 안됨
        setGameState('login');
      }
    });

    return () => unsubscribe();
  }, []);

  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed:", error);
      alert("로그인에 실패했습니다.");
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setUserProfile(null);
  };

  const generateRandomName = () => {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    setGeneratedName(`${adj} ${noun}`);
  };

  const saveProfile = async () => {
    const user = auth.currentUser;
    if (!user) return;

    // 6자리 무작위 시리얼 번호 생성
    const discriminator = Math.floor(100000 + Math.random() * 900000).toString();
    
    const newProfile = {
      uid: user.uid,
      nickname: generatedName,
      discriminator: discriminator,
      gold: 0,
      profilePic: 'default_01', // 향후 프로필 사진 기능 확장용
      createdAt: new Date().toISOString()
    };

    try {
      await setDoc(doc(db, 'users', user.uid), newProfile);
      setUserProfile(newProfile);
      setGameState('menu');
    } catch (error) {
      console.error("Profile save failed:", error);
      alert("프로필 생성 중 오류가 발생했습니다.");
    }
  };

  const startMatchmaking = () => {
    setGameState('matchmaking');
    
    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', (id) => {
      console.log('My peer ID is: ' + id);
      setPeerId(id);

      findMatch(id, (opponentPeerId, amIHost) => {
        setIsHost(amIHost);
        
        if (amIHost) {
          // 호스트 대기
        } else {
          // 게스트가 호스트에게 연결
          console.log('Connecting to host:', opponentPeerId);
          const conn = peer.connect(opponentPeerId);
          setupConnection(conn);
        }
      }).catch(err => {
        console.error('Matchmaking error:', err);
        setGameState('menu');
        alert('매칭 실패! 파이어베이스 오류입니다.\n원인: ' + err.message);
      });
    });

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
      {gameState === 'loading' && (
        <div className="text-white text-xl animate-pulse">Loading...</div>
      )}

      {gameState === 'login' && (
        <div className="glass-panel p-10 max-w-md w-full text-center flex flex-col items-center gap-8">
          <div className="flex items-center justify-center gap-3">
            <Crosshair className="w-12 h-12 text-neon-blue" />
            <h1 className="text-4xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-neon-blue to-purple-500">
              BATTLE
            </h1>
          </div>
          <p className="text-slate-300">Google 계정으로 로그인하여 시작하세요</p>
          
          <button 
            onClick={handleGoogleLogin}
            className="glass-button w-full flex items-center justify-center gap-2 bg-white text-slate-900 hover:bg-slate-200"
          >
            <LogIn className="w-5 h-5" />
            <span className="font-bold">Google Login</span>
          </button>
        </div>
      )}

      {gameState === 'create_profile' && (
        <div className="glass-panel p-10 max-w-md w-full text-center flex flex-col items-center gap-6">
          <h2 className="text-2xl font-bold text-white">프로필 생성</h2>
          <p className="text-slate-400">당신의 멋진 닉네임을 뽑아보세요!</p>
          
          <div className="bg-slate-800/80 p-6 rounded-xl border border-slate-700 w-full">
            <div className="text-3xl font-black text-neon-blue mb-2">{generatedName}</div>
            <div className="text-slate-500 text-sm">#??????</div>
          </div>

          <div className="flex gap-4 w-full mt-4">
            <button 
              onClick={generateRandomName}
              className="glass-button flex-1 flex items-center justify-center gap-2 bg-slate-700/80 hover:bg-slate-600/80"
            >
              <Dices className="w-5 h-5" /> 다시 뽑기
            </button>
            <button 
              onClick={saveProfile}
              className="glass-button-primary flex-1"
            >
              결정하기
            </button>
          </div>
        </div>
      )}

      {gameState === 'menu' && userProfile && (
        <div className="glass-panel p-8 max-w-md w-full text-center flex flex-col items-center gap-6">
          
          {/* 유저 프로필 영역 */}
          <div className="w-full bg-slate-800/50 rounded-xl p-4 border border-slate-700 flex flex-col items-center gap-2 relative">
            <button onClick={handleLogout} className="absolute top-2 right-2 text-xs text-slate-500 hover:text-white transition-colors">로그아웃</button>
            <div className="w-16 h-16 bg-slate-700 rounded-full flex items-center justify-center border-2 border-neon-blue shadow-[0_0_15px_rgba(59,130,246,0.5)]">
              <span className="text-2xl">😎</span>
            </div>
            <div>
              <div className="text-xl font-bold text-white">{userProfile.nickname} <span className="text-slate-500 text-sm">#{userProfile.discriminator}</span></div>
            </div>
            <div className="bg-yellow-500/20 border border-yellow-500/50 text-yellow-400 font-bold px-4 py-1 rounded-full text-sm mt-2 flex items-center gap-1">
              <span>💰</span> {userProfile.gold} G
            </div>
          </div>

          <div className="w-full flex flex-col gap-4 mt-2">
            <button 
              onClick={startMatchmaking}
              className="glass-button-primary w-full py-4 text-xl"
            >
              Find Match
            </button>
            <button className="glass-button bg-slate-700/50 hover:bg-slate-600/50 w-full border-slate-600">
              상점 (Shop)
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
