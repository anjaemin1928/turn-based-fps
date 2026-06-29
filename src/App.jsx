import { useState, useRef, useEffect } from 'react'
import { Crosshair, LogIn, Dices, Settings, Search, X } from 'lucide-react'
import Peer from 'peerjs'
import { auth, googleProvider, db } from './firebase'
import { signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth'
import { doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, getCountFromServer } from 'firebase/firestore'
const getPixelCoords = (item) => {
  let px = item.x * 100;
  let py = item.y * 100;
  
  const pivot = item.pivot || 'center';
  let tx = '-50%';
  let ty = '-50%';
  
  if (pivot.includes('left')) tx = '0%';
  else if (pivot.includes('right')) tx = '-100%';
  
  if (pivot.includes('top')) ty = '0%';
  else if (pivot.includes('bottom')) ty = '-100%';
  
  return { left: px, top: py, transform: `translate(${tx}, ${ty})` };
};

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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const localSessionId = useRef(Math.random().toString(36).substring(2, 15));
  
  // Camera & Layout states
  // PeerJS states
  const [peerId, setPeerId] = useState('');
  const keys = useRef({ w: false, a: false, s: false, d: false });
  const requestRef = useRef();
  const mousePos = useRef({ x: 0, y: 0 });
  const getScaleForPerfectGrids = () => (typeof window !== 'undefined' ? window.innerWidth / 2160 : 0.7); // 54 grids * 40px = 2160px
  const targetZoom = useRef(getScaleForPerfectGrids());
  const currentZoom = useRef(getScaleForPerfectGrids());

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (e.isTrusted) {
        mousePos.current.x = e.clientX;
        mousePos.current.y = e.clientY;
      }
    };
    
    const handleResize = () => {
      const scale = getScaleForPerfectGrids();
      targetZoom.current = scale;
      currentZoom.current = scale;
      if (cameraRef.current) {
        cameraRef.current.style.transform = `translate(${cameraPos.current.x * scale}px, ${cameraPos.current.y * scale}px) scale(${scale})`;
      }
      updateGridZones(cameraPos.current.x, cameraPos.current.y, scale);
      if (railLeftRef.current) {
        railLeftRef.current.style.left = `calc(50vw + ${(-480 + cameraPos.current.x) * scale}px)`;
        railLeftRef.current.style.width = `${24 * scale}px`;
      }
      if (railRightRef.current) {
        railRightRef.current.style.left = `calc(50vw + ${(880 + cameraPos.current.x) * scale}px)`;
        railRightRef.current.style.width = `${24 * scale}px`;
      }
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const UILayout = {
    camera: { x: -3, y: -3, width: 1000, height: 700, pivot: 'top-left' },
    profile: { x: -3, y: -3, pivot: 'top-left' },
    settings: { x: 7.3, y: -3, pivot: 'top-right' }, // Right edge at 730px (20px gap from panel)
    settingsPanel: { x: 8.8, y: -3, pivot: 'top-center' }, // Horizontally centered exactly on the right rail (880px)
    matchBtn: { x: 2, y: 4, pivot: 'bottom-center' },
    login: { x: 0, y: 0.5, pivot: 'center' },
    createProfile: { x: 0, y: 0, pivot: 'center' },
    matchmaking: { x: 0, y: 0.5, pivot: 'center' },
    playing: { x: 0, y: 0, pivot: 'center' }
  };
  
  // 카메라 초기 위치를 UILayout.camera 를 통해 화면(지정된 카메라 크기 기준) 정중앙에 맞추기
  const cameraPos = useRef((() => {
    const cam = UILayout.camera;
    if (!cam) return { x: 0, y: 0 };
    const width = cam.width || 800; const height = cam.height || 600;
    const cellW = Math.ceil(width / 100); const cellH = Math.ceil(height / 100);
    const gridAreaW = cellW * 100; const gridAreaH = cellH * 100;
    
    let px = cam.x * 100; let py = cam.y * 100;
    if (cam.pivot.includes('left')) px += width / 2;
    else if (cam.pivot.includes('right')) px += gridAreaW - width / 2;
    else px += gridAreaW / 2;
    
    if (cam.pivot.includes('top')) py += height / 2;
    else if (cam.pivot.includes('bottom')) py += gridAreaH - height / 2;
    else py += gridAreaH / 2;
    
    return { x: -px, y: -py };
  })());
  const cameraRef = useRef(null);
  const gridZoneRefs = [useRef(null), useRef(null), useRef(null), useRef(null)];
  const railLeftRef = useRef(null);
  const railRightRef = useRef(null);

  // 레일 월드 좌표 & 접힘 폭 상수
  const RAIL_LEFT_WORLD = -480;
  const RAIL_RIGHT_WORLD = 880;
  const FOLD_SHIFT = 12; // 레일 너비(24px)의 절반 = 양쪽에서 각각 12px씩 당김
  const MIDPOINT_WORLD = (RAIL_LEFT_WORLD + RAIL_RIGHT_WORLD) / 2; // 200

  // 4구역 그리드 업데이트 헬퍼 (양쪽 접힘 효과)
  const updateGridZones = (camX, camY, zoom) => {
    const halfW = window.innerWidth / 2;
    const railLeftX = halfW + (RAIL_LEFT_WORLD + camX) * zoom;
    const railRightX = halfW + (RAIL_RIGHT_WORLD + camX) * zoom;
    const midpointX = halfW + (MIDPOINT_WORLD + camX) * zoom;
    const bgSize = `${40 * zoom}px ${40 * zoom}px`;
    const bgY = `calc(50vh + ${camY * zoom}px)`;
    // 전체적으로 12px 오른쪽 이동 반영
    const shifts = [8, 24, 24, 0];
    const clips = [
      `polygon(0 0, ${railLeftX}px 0, ${railLeftX}px 100%, 0 100%)`,
      `polygon(${railLeftX}px 0, ${midpointX}px 0, ${midpointX}px 100%, ${railLeftX}px 100%)`,
      `polygon(${midpointX}px 0, ${railRightX}px 0, ${railRightX}px 100%, ${midpointX}px 100%)`,
      `polygon(${railRightX}px 0, 100% 0, 100% 100%, ${railRightX}px 100%)`
    ];
    gridZoneRefs.forEach((ref, i) => {
      if (ref.current) {
        ref.current.style.backgroundSize = bgSize;
        ref.current.style.backgroundPosition = `calc(50vw + ${(camX + shifts[i]) * zoom}px) ${bgY}`;
        ref.current.style.clipPath = clips[i];
      }
    });
  };

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

  // 세로 전용 카메라 이동 (W/S키)
  useEffect(() => {
    const handleMouseDown = (e) => {
      const target = e.target.closest('[data-ui-interactive="true"]');
      if (target) {
        target.setAttribute('data-pressed', 'true');
      }
    };

    const handleMouseUp = (e) => {
      const target = e.target.closest('[data-ui-interactive="true"]');
      if (target) {
        setTimeout(() => {
          target.removeAttribute('data-pressed');
        }, 120);
      } else {
        document.querySelectorAll('[data-pressed="true"]').forEach(el => {
          setTimeout(() => el.removeAttribute('data-pressed'), 120);
        });
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'w' || e.key === 'W') keys.current.w = true;
      if (e.key === 's' || e.key === 'S') keys.current.s = true;
    };

    const handleKeyUp = (e) => {
      if (e.key === 'w' || e.key === 'W') keys.current.w = false;
      if (e.key === 's' || e.key === 'S') keys.current.s = false;
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const updateCamera = () => {

      // W/S 세로 이동 (가로 잠금)
      const speed = 5;
      let moved = false;
      if (keys.current.w) { cameraPos.current.y += speed; moved = true; }
      if (keys.current.s) { cameraPos.current.y -= speed; moved = true; }

      if (moved) {
        const zoom = currentZoom.current;
        if (cameraRef.current) {
          cameraRef.current.style.transform = `translate(${cameraPos.current.x * zoom}px, ${cameraPos.current.y * zoom}px) scale(${zoom})`;
        }
        updateGridZones(cameraPos.current.x, cameraPos.current.y, zoom);
      }

      let zoomChanged = false;
      let newZoom = currentZoom.current;
      let oldZoom = currentZoom.current;

      // Smooth zoom interpolation
      if (Math.abs(targetZoom.current - currentZoom.current) > 0.0005) {
        oldZoom = currentZoom.current;
        currentZoom.current += (targetZoom.current - currentZoom.current) * 0.15;
        newZoom = currentZoom.current;
        zoomChanged = true;
      } else if (targetZoom.current !== currentZoom.current) {
        oldZoom = currentZoom.current;
        currentZoom.current = targetZoom.current;
        newZoom = currentZoom.current;
        zoomChanged = true;
      }

      if (zoomChanged) {
        let nextX = cameraPos.current.x;
        let nextY = cameraPos.current.y;
        
        if (cameraRef.current) {
          cameraRef.current.style.transform = `translate(${nextX * newZoom}px, ${nextY * newZoom}px) scale(${newZoom})`;
        }
        updateGridZones(nextX, nextY, newZoom);
        if (railLeftRef.current) {
          railLeftRef.current.style.left = `calc(50vw + ${(-480 + nextX) * newZoom}px)`;
          railLeftRef.current.style.width = `${24 * newZoom}px`;
        }
        if (railRightRef.current) {
          railRightRef.current.style.left = `calc(50vw + ${(880 + nextX) * newZoom}px)`;
          railRightRef.current.style.width = `${24 * newZoom}px`;
        }
      } else {
        const rx = Math.round(cameraPos.current.x);
        const ry = Math.round(cameraPos.current.y);
        if (cameraPos.current.x !== rx || cameraPos.current.y !== ry) {
          cameraPos.current.x = rx;
          cameraPos.current.y = ry;
          if (cameraRef.current) {
            cameraRef.current.style.transform = `translate(${rx * newZoom}px, ${ry * newZoom}px) scale(${newZoom})`;
          }
          updateGridZones(rx, ry, newZoom);
          if (railLeftRef.current) {
            railLeftRef.current.style.left = `calc(50vw + ${(-480 + rx) * newZoom}px)`;
          }
          if (railRightRef.current) {
            railRightRef.current.style.left = `calc(50vw + ${(880 + rx) * newZoom}px)`;
          }
        }
      }
      
      // 마우스가 UI 요소 위에 있는지 AABB 충돌 검사하여 hover 상태 수동 계산
      const interactives = document.querySelectorAll('[data-ui-interactive="true"]');
      const mx = mousePos.current.x;
      const my = mousePos.current.y;
      interactives.forEach(el => {
        const rect = el.getBoundingClientRect();
        const isInside = mx >= rect.left && mx <= rect.right && my >= rect.top && my <= rect.bottom;
        if (isInside) {
          if (el.getAttribute('data-hovered') !== 'true') el.setAttribute('data-hovered', 'true');
        } else {
          if (el.getAttribute('data-hovered') === 'true') el.setAttribute('data-hovered', 'false');
        }
      });

      requestRef.current = requestAnimationFrame(updateCamera);
    };

    requestRef.current = requestAnimationFrame(updateCamera);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      cancelAnimationFrame(requestRef.current);
    };
  }, []);

  return (
    <div 
      className="w-full h-screen overflow-hidden relative select-none bg-blueprint-bg"
    >
      {/* 4구역 그리드: 각 레일에서 양쪽으로 12px씩 당겨지는 Z접힘 효과 */}
      {gridZoneRefs.map((ref, i) => {
        const zoom = currentZoom.current;
        const camX = cameraPos.current.x;
        const camY = cameraPos.current.y;
        const halfW = typeof window !== 'undefined' ? window.innerWidth / 2 : 960;
        const railLeftX = halfW + (-480 + camX) * zoom;
        const railRightX = halfW + (880 + camX) * zoom;
        const midpointX = halfW + (200 + camX) * zoom;
        const shifts = [8, 24, 24, 0];
        const clips = [
          `polygon(0 0, ${railLeftX}px 0, ${railLeftX}px 100%, 0 100%)`,
          `polygon(${railLeftX}px 0, ${midpointX}px 0, ${midpointX}px 100%, ${railLeftX}px 100%)`,
          `polygon(${midpointX}px 0, ${railRightX}px 0, ${railRightX}px 100%, ${midpointX}px 100%)`,
          `polygon(${railRightX}px 0, 100% 0, 100% 100%, ${railRightX}px 100%)`
        ];
        return (
          <div
            key={i}
            ref={ref}
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Cline x1='0' y1='0' x2='40' y2='0' stroke='rgba(51,65,85,0.2)' stroke-width='1' vector-effect='non-scaling-stroke' shape-rendering='crispEdges'/%3E%3Cline x1='0' y1='0' x2='0' y2='40' stroke='rgba(51,65,85,0.2)' stroke-width='1' vector-effect='non-scaling-stroke' shape-rendering='crispEdges'/%3E%3C/svg%3E")`,
              backgroundSize: `${40 * zoom}px ${40 * zoom}px`,
              backgroundPosition: `calc(50vw + ${(camX + shifts[i]) * zoom}px) calc(50vh + ${camY * zoom}px)`,
              clipPath: clips[i]
            }}
          />
        );
      })}

      {/* 기계식 레일 (바깥으로 빼서 보더라인 안티앨리어싱 방지) */}
      <div 
        ref={railLeftRef}
        className="mechanical-rail" 
        style={{ left: `calc(50vw + ${(-480 + cameraPos.current.x) * currentZoom.current}px)`, width: `${24 * currentZoom.current}px` }} 
      />
      <div 
        ref={railRightRef}
        className="mechanical-rail" 
        style={{ left: `calc(50vw + ${(880 + cameraPos.current.x) * currentZoom.current}px)`, width: `${24 * currentZoom.current}px` }} 
      />

      <div 
        ref={cameraRef}
        className="absolute top-1/2 left-1/2 w-0 h-0"
        style={{ 
          transform: `translate(${cameraPos.current.x * currentZoom.current}px, ${cameraPos.current.y * currentZoom.current}px) scale(${currentZoom.current})`,
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
            className="absolute glass-panel p-8 w-[400px] h-[300px] flex flex-col items-center justify-center gap-6"
            style={getPixelCoords(UILayout.login)}
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
              data-ui-interactive="true"
              className="w-full flex items-center justify-center gap-2 bg-white text-slate-900 data-[hovered=true]:bg-slate-200 px-6 py-3 rounded-lg font-bold transition-all duration-300 transform data-[hovered=true]:scale-105 active:scale-95"
            >
              <LogIn className="w-5 h-5 text-slate-900" />
              <span>Google Login</span>
            </button>
          </div>
        )}

        {gameState === 'create_profile' && (
          <div 
            className="absolute glass-panel p-8 w-[400px] h-[400px] flex flex-col items-center justify-center gap-6"
            style={getPixelCoords(UILayout.createProfile)}
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
                data-ui-interactive="true"
                className="glass-button flex-1 flex items-center justify-center gap-2 bg-slate-700/80 data-[hovered=true]:bg-slate-600/80"
              >
                <Dices className="w-5 h-5" /> 랜덤 뽑기
              </button>
              <button 
                onClick={saveProfile}
                data-ui-interactive="true"
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
              className="absolute blueprint-box flex items-center gap-4 w-[350px] h-[120px]"
              style={getPixelCoords(UILayout.profile)}
            >
              <div className="w-20 h-20 bg-slate-200 border-2 border-slate-800 rounded-sm flex shrink-0 items-center justify-center overflow-hidden">
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
                  <button onClick={handleLogout} data-ui-interactive="true" className="underline font-bold text-slate-600 data-[hovered=true]:text-red-600 cursor-pointer relative z-10">LOGOUT</button>
                </div>
              </div>
            </div>

            {/* 설정 버튼 */}
            <button 
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              data-ui-interactive="true"
              className="absolute blueprint-btn-secondary w-[150px] h-[50px]"
              style={getPixelCoords(UILayout.settings)}
            >
              <Settings className="w-5 h-5" />
              <span>SETTINGS</span>
            </button>

            {/* 세팅 패널 (우측 레일에 매달림) */}
            {isSettingsOpen && (
              <div 
                className="absolute blueprint-box w-[260px] flex flex-col gap-0"
                style={{
                  ...getPixelCoords(UILayout.settingsPanel),
                  padding: 0
                }}
              >
                {/* 패널 헤더 */}
                <div className="flex items-center justify-between border-b-2 border-slate-800 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Settings className="w-4 h-4" />
                    <span className="font-bold text-sm uppercase tracking-widest">Settings</span>
                  </div>
                  <button 
                    onClick={() => setIsSettingsOpen(false)}
                    data-ui-interactive="true"
                    className="w-6 h-6 flex items-center justify-center border border-slate-800 bg-white data-[hovered=true]:bg-red-100 data-[hovered=true]:border-red-500 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>

                {/* 사운드 섹션 */}
                <div className="px-4 py-3 border-b border-slate-300">
                  <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Sound</div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold">Master</span>
                      <div className="w-[120px] h-2 bg-slate-200 border border-slate-800">
                        <div className="h-full bg-blueprint-green" style={{ width: '80%' }}></div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold">BGM</span>
                      <div className="w-[120px] h-2 bg-slate-200 border border-slate-800">
                        <div className="h-full bg-blueprint-green" style={{ width: '60%' }}></div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold">SFX</span>
                      <div className="w-[120px] h-2 bg-slate-200 border border-slate-800">
                        <div className="h-full bg-blueprint-green" style={{ width: '100%' }}></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 디스플레이 섹션 */}
                <div className="px-4 py-3 border-b border-slate-300">
                  <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Display</div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold">Language</span>
                      <span className="text-sm font-bold text-slate-600">한국어</span>
                    </div>
                  </div>
                </div>

                {/* 계정 섹션 */}
                <div className="px-4 py-3">
                  <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Account</div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold">Version</span>
                      <span className="text-xs font-bold text-slate-400">v0.1.0</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 매칭 버튼 */}
            <div 
              className="absolute flex flex-col items-center w-[400px] h-[80px]"
              style={getPixelCoords(UILayout.matchBtn)}
            >
              <button 
                onClick={startMatchmaking}
                data-ui-interactive="true"
                className="blueprint-btn w-full"
              >
                FIND MATCH
              </button>
            </div>
          </>
        )}

        {gameState === 'matchmaking' && (
          <div 
            className="absolute glass-panel p-10 w-[400px] h-[300px] flex flex-col items-center justify-center gap-6"
            style={getPixelCoords(UILayout.matchmaking)}
          >
            <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-neon-blue"></div>
            <h2 className="text-2xl font-bold text-white">Searching for opponent...</h2>
            <p className="text-slate-400">Connecting to Firebase Signaling Server</p>
            <button 
              onClick={cancelMatchmaking}
              data-ui-interactive="true"
              className="glass-button-danger mt-4"
            >
              Cancel
            </button>
          </div>
        )}

        {gameState === 'playing' && connection && (
          <div 
            className="absolute w-[800px] h-[600px] bg-slate-900 rounded-xl overflow-hidden shadow-2xl"
            style={getPixelCoords(UILayout.playing)}
          >
            <Game conn={connection} isHost={isHost} />
          </div>
        )}
      </div>
    </div>
  )
}

export default App
