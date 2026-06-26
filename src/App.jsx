import { useState, useRef, useEffect } from 'react'
import { Crosshair, LogIn, Dices, Settings, Search, X } from 'lucide-react'
import Peer from 'peerjs'
import { auth, googleProvider, db } from './firebase'
import { signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth'
import { doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, getCountFromServer } from 'firebase/firestore'
import { findMatch } from './matchmaking'
import Game from './Game'

const ADJECTIVES = [
  "멋진", "강력한", "귀여운", "화난", "배고픈", "빛나는", "어둠의", "빠른", "느린", "전설의",
  "신비한", "거대한", "작은", "용감한", "소심한", "게으른", "부지런한", "똑똑한", "엉뚱한", "행복한",
  "슬픈", "졸린", "불타는", "얼어붙은", "맹독의", "치명적인", "사랑스러운", "무서운", "기묘한", "미친"
];
const NOUNS = [
  "강아지", "고양이", "호랑이", "사자", "토끼", "돼지", "독수리", "용", "거북이", "늑대",
  "곰", "여우", "사슴", "뱀", "상어", "고래", "펭귄", "부엉이", "까마귀", "쥐",
  "다람쥐", "오리", "거위", "악어", "하마", "코끼리", "기린", "원숭이", "고릴라", "판다"
];



function App() {
  const [gameState, setGameState] = useState('loading'); // loading, login, create_profile, menu, matchmaking, playing
  const [userProfile, setUserProfile] = useState(null);
  const [selectedAdj, setSelectedAdj] = useState(ADJECTIVES[0]);
  const [selectedNoun, setSelectedNoun] = useState(NOUNS[0]);
  const localSessionId = useRef(Math.random().toString(36).substring(2, 15));
  
  // Camera & Layout states
  const [cameraPos, setCameraPos] = useState({ x: 0, y: 0 });
  const keys = useRef({ w: false, a: false, s: false, d: false });
  const requestRef = useRef();

  const UILayout = {
    profile: { x: -200, y: -160 },
    settings: { x: 200, y: -160 },
    matchBtn: { x: 0, y: 160 },
    login: { x: 0, y: 0 },
    createProfile: { x: 0, y: 0 },
    matchmaking: { x: 0, y: 0 },
    playing: { x: 0, y: 0 }
  };
  
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
          // 기존 유저: 접속할 때마다 내 세션 ID로 덮어쓰기 + 누락된 필드 자동 보완 (마이그레이션)
          const data = userSnap.data();
          const updates = { sessionId: localSessionId.current };
          
          if (data.level === undefined) updates.level = 1;
          if (data.exp === undefined) updates.exp = 0;
          if (data.rank === undefined) updates.rank = 'TACTICIAN';
          if (data.mmr === undefined) updates.mmr = 1000;
          
          await updateDoc(userDocRef, updates);
          setUserProfile({ ...data, ...updates });
          setGameState('menu');
        } else {
          // 신규 유저
          generateRandomName();
          setGameState('create_profile');
        }
      } else {
        // 로그인 안됨
        setGameState('login');
        setUserProfile(null);
      }
    });

    return () => unsubscribe();
  }, []);

  // 세션 감시용 리스너 (프로필이 생성/로드된 이후부터 작동)
  useEffect(() => {
    const user = auth.currentUser;
    if (!user || !userProfile) return;

    const userDocRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
      const data = docSnap.data();
      // DB의 세션 ID가 내 로컬 세션 ID와 다르면 강제 로그아웃
      if (data && data.sessionId && data.sessionId !== localSessionId.current) {
        alert("다른 기기에서 접속하여 로그아웃됩니다.");
        signOut(auth);
      }
    });

    return () => unsubscribe();
  }, [userProfile]);

  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed:", error);
      alert("로그인에 실패했습니다. 원인: " + error.message + "\n(승인된 도메인 문제일 확률이 높습니다!)");
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setUserProfile(null);
  };

  const generateRandomName = () => {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    setSelectedAdj(adj);
    setSelectedNoun(noun);
  };

  const saveProfile = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const finalNickname = `${selectedAdj} ${selectedNoun}`;
    const discriminator = Math.floor(100000 + Math.random() * 900000).toString();
    
    const newProfile = {
      uid: user.uid,
      nickname: finalNickname,
      discriminator: discriminator,
      gold: 0,
      level: 1,
      exp: 0,
      rank: 'TACTICIAN',
      mmr: 1000,
      profilePic: 'default_01',
      sessionId: localSessionId.current,
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

      findMatch(id, auth.currentUser.uid, (opponentPeerId, amIHost) => {
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

  // Smooth WASD Camera Movement with Momentum
  const velocity = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(key)) {
        keys.current[key] = true;
      }
    };

    const handleKeyUp = (e) => {
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(key)) {
        keys.current[key] = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const maxSpeed = 7; // 속도 제한 (눈 피로도 감소를 위해 기존 12에서 7로 감소)
    const acceleration = 0.5; // 가속도 (스무딩)
    const friction = 0.9; // 마찰력 (키를 뗐을 때 부드러운 감속)

    const updateCamera = () => {
      let accelX = 0;
      let accelY = 0;
      
      if (keys.current.w) accelY += acceleration;
      if (keys.current.s) accelY -= acceleration;
      if (keys.current.a) accelX += acceleration;
      if (keys.current.d) accelX -= acceleration;

      velocity.current.x += accelX;
      velocity.current.y += accelY;

      velocity.current.x *= friction;
      velocity.current.y *= friction;

      const speed = Math.sqrt(velocity.current.x ** 2 + velocity.current.y ** 2);
      if (speed > maxSpeed) {
        const ratio = maxSpeed / speed;
        velocity.current.x *= ratio;
        velocity.current.y *= ratio;
      }

      if (Math.abs(velocity.current.x) < 0.05) velocity.current.x = 0;
      if (Math.abs(velocity.current.y) < 0.05) velocity.current.y = 0;

      if (velocity.current.x !== 0 || velocity.current.y !== 0) {
        setCameraPos(prev => ({ 
          x: prev.x + velocity.current.x, 
          y: prev.y + velocity.current.y 
        }));
      }
      requestRef.current = requestAnimationFrame(updateCamera);
    };

    requestRef.current = requestAnimationFrame(updateCamera);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      cancelAnimationFrame(requestRef.current);
    };
  }, []);

  return (
    <div 
      className="w-full h-screen overflow-hidden relative select-none"
      style={{
        backgroundImage: 'linear-gradient(var(--color-blueprint-line) 1px, transparent 1px), linear-gradient(90deg, var(--color-blueprint-line) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
        backgroundPosition: `${cameraPos.x}px ${cameraPos.y}px`,
        willChange: 'background-position'
      }}
    >
      <div 
        className="absolute top-1/2 left-1/2 w-0 h-0"
        style={{ 
          transform: `translate(${cameraPos.x}px, ${cameraPos.y}px)`,
          willChange: 'transform'
        }}
      >
        {gameState === 'loading' && (
          <div 
            className="absolute text-white text-xl animate-pulse"
            style={{ transform: 'translate(-50%, -50%)' }}
          >
            Loading...
          </div>
        )}

        {gameState === 'login' && (
          <div 
            className="absolute glass-panel p-10 w-[400px] text-center flex flex-col items-center gap-8"
            style={{ left: UILayout.login.x, top: UILayout.login.y, transform: 'translate(-50%, -50%)' }}
          >
            <div className="flex items-center justify-center gap-3">
              <Crosshair className="w-12 h-12 text-neon-blue" />
              <h1 className="text-4xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-neon-blue to-purple-500">
                BATTLE
              </h1>
            </div>
            <p className="text-slate-300">Google 계정으로 로그인하여 시작하세요</p>
            
            <button 
              onClick={handleGoogleLogin}
              className="w-full flex items-center justify-center gap-2 bg-white text-slate-900 hover:bg-slate-200 px-6 py-3 rounded-lg font-bold transition-all duration-300 transform hover:scale-105 active:scale-95"
            >
              <LogIn className="w-5 h-5 text-slate-900" />
              <span>Google Login</span>
            </button>
          </div>
        )}

        {gameState === 'create_profile' && (
          <div 
            className="absolute glass-panel p-8 w-[400px] text-center flex flex-col items-center gap-6"
            style={{ left: UILayout.createProfile.x, top: UILayout.createProfile.y, transform: 'translate(-50%, -50%)' }}
          >
            <h2 className="text-2xl font-bold text-white">프로필 생성</h2>
            <p className="text-slate-400">자신만의 닉네임을 조합해 보세요!</p>
            
            <div className="flex gap-2 w-full">
              <select 
                value={selectedAdj} 
                onChange={(e) => setSelectedAdj(e.target.value)}
                className="flex-1 bg-slate-800 text-white border border-slate-600 rounded-lg p-2 outline-none focus:border-neon-blue"
              >
                {ADJECTIVES.map(adj => <option key={adj} value={adj}>{adj}</option>)}
              </select>
              <select 
                value={selectedNoun} 
                onChange={(e) => setSelectedNoun(e.target.value)}
                className="flex-1 bg-slate-800 text-white border border-slate-600 rounded-lg p-2 outline-none focus:border-neon-blue"
              >
                {NOUNS.map(noun => <option key={noun} value={noun}>{noun}</option>)}
              </select>
            </div>

            <div className="bg-slate-800/80 p-6 rounded-xl border border-slate-700 w-full mt-2">
              <div className="text-3xl font-black text-neon-blue mb-2">{selectedAdj} {selectedNoun}</div>
              <div className="text-slate-500 text-sm">#?????? (무작위 발급)</div>
            </div>

            <div className="flex gap-4 w-full mt-2">
              <button 
                onClick={generateRandomName}
                className="glass-button flex-1 flex items-center justify-center gap-2 bg-slate-700/80 hover:bg-slate-600/80"
              >
                <Dices className="w-5 h-5" /> 랜덤 뽑기
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
          <>
            {/* 유저 프로필 박스 */}
            <div 
              className="absolute blueprint-box flex items-center gap-4 w-[350px]"
              style={{ left: UILayout.profile.x, top: UILayout.profile.y, transform: 'translate(-50%, -50%)' }}
            >
              <div className="w-20 h-20 bg-slate-200 border-2 border-slate-800 rounded-full flex shrink-0 items-center justify-center overflow-hidden">
                <span className="text-4xl">😎</span>
              </div>
              <div className="flex-1">
                <div className="text-xl font-bold tracking-wide break-all">{userProfile.nickname}<span className="text-sm text-slate-500 ml-1">#{userProfile.discriminator}</span></div>
                <div className="flex justify-between items-end mt-1">
                  <div className="font-bold">LVL {userProfile.level || 1}</div>
                  <div className="text-xs font-bold text-slate-500">{userProfile.exp || 0}%</div>
                </div>
                <div className="w-full h-2 bg-slate-200 border border-slate-800 mt-1">
                  <div className="h-full bg-blueprint-green" style={{ width: `${userProfile.exp || 0}%` }}></div>
                </div>
                <div className="text-xs mt-2 flex items-center justify-between border-t border-slate-300 pt-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-700">MMR: {userProfile.mmr || 1000}</span>
                  </div>
                  <button onClick={handleLogout} className="underline font-bold text-slate-600 hover:text-red-600 cursor-pointer relative z-10">LOGOUT</button>
                </div>
              </div>
            </div>

            {/* 설정 버튼 */}
            <button 
              className="absolute blueprint-btn-secondary"
              style={{ left: UILayout.settings.x, top: UILayout.settings.y, transform: 'translate(-50%, -50%)' }}
            >
              <Settings className="w-5 h-5" />
              <span>SETTINGS</span>
            </button>

            {/* 매칭 버튼 */}
            <div 
              className="absolute flex flex-col items-center w-[400px]"
              style={{ left: UILayout.matchBtn.x, top: UILayout.matchBtn.y, transform: 'translate(-50%, -50%)' }}
            >
              <button 
                onClick={startMatchmaking}
                className="blueprint-btn w-full"
              >
                FIND MATCH
              </button>
            </div>
          </>
        )}

        {gameState === 'matchmaking' && (
          <div 
            className="absolute glass-panel p-10 w-[400px] text-center flex flex-col items-center gap-6"
            style={{ left: UILayout.matchmaking.x, top: UILayout.matchmaking.y, transform: 'translate(-50%, -50%)' }}
          >
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
          <div 
            className="absolute w-[800px] h-[600px] bg-slate-900 rounded-xl overflow-hidden shadow-2xl"
            style={{ left: UILayout.playing.x, top: UILayout.playing.y, transform: 'translate(-50%, -50%)' }}
          >
            <Game conn={connection} isHost={isHost} />
          </div>
        )}
      </div>
    </div>
  )
}

export default App
