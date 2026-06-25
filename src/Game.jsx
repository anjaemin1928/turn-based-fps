import { useState, useEffect } from 'react';

export default function Game({ conn, isHost }) {
  // 10x10 격자 배열 생성 (0: 빈칸)
  const [board, setBoard] = useState(Array(10).fill(Array(10).fill(null)));
  
  // 임시: 내 유닛 상태 (체력 100, 이동칸수 3)
  const [myUnits, setMyUnits] = useState([
    { id: 'u1', x: 2, y: isHost ? 9 : 0, hp: 100, attack: 30, maxMove: 3 },
    { id: 'u2', x: 5, y: isHost ? 9 : 0, hp: 100, attack: 30, maxMove: 3 },
    { id: 'u3', x: 8, y: isHost ? 9 : 0, hp: 100, attack: 30, maxMove: 3 },
  ]);

  // 임시: 상대방 유닛 상태
  const [enemyUnits, setEnemyUnits] = useState([
    { id: 'e1', x: 2, y: isHost ? 0 : 9, hp: 100 },
    { id: 'e2', x: 5, y: isHost ? 0 : 9, hp: 100 },
    { id: 'e3', x: 8, y: isHost ? 0 : 9, hp: 100 },
  ]);

  // PeerJS 데이터 수신 처리
  useEffect(() => {
    if (!conn) return;

    conn.on('data', (data) => {
      console.log('Received data:', data);
      if (data.type === 'MOVE') {
        // 상대방이 유닛을 이동시켰을 때 처리 (임시)
        setEnemyUnits(prev => prev.map(u => 
          u.id === data.unitId ? { ...u, x: data.x, y: data.y } : u
        ));
      }
    });
  }, [conn]);

  const handleCellClick = (x, y) => {
    console.log(`Clicked cell: ${x}, ${y}`);
    // TODO: 이동 및 공격 로직 구현
  };

  return (
    <div className="flex flex-col items-center gap-6 p-4 w-full h-full">
      <div className="flex justify-between w-full max-w-2xl text-white font-bold px-4">
        <div className="bg-red-900/50 p-3 rounded-lg border border-red-500/30">
          Enemy Units: {enemyUnits.length}
        </div>
        <div className="bg-blue-900/50 p-3 rounded-lg border border-blue-500/30">
          My Units: {myUnits.length}
        </div>
      </div>

      <div className="glass-panel p-4 inline-block">
        <div className="grid grid-cols-10 grid-rows-10 gap-1 w-[400px] h-[400px] md:w-[600px] md:h-[600px]">
          {Array(10).fill(0).map((_, y) => 
            Array(10).fill(0).map((_, x) => {
              // 해당 셀에 있는 유닛 찾기
              const myUnit = myUnits.find(u => u.x === x && u.y === y);
              const enemyUnit = enemyUnits.find(u => u.x === x && u.y === y);

              return (
                <div 
                  key={`${x}-${y}`} 
                  className="grid-cell flex items-center justify-center rounded-sm"
                  onClick={() => handleCellClick(x, y)}
                >
                  {myUnit && (
                    <div className="w-4/5 h-4/5 bg-blue-500 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.8)] border-2 border-blue-200">
                      <span className="text-[10px] text-white flex justify-center mt-1">{myUnit.hp}</span>
                    </div>
                  )}
                  {enemyUnit && (
                    <div className="w-4/5 h-4/5 bg-red-500 rounded-full shadow-[0_0_10px_rgba(239,68,68,0.8)] border-2 border-red-200">
                      <span className="text-[10px] text-white flex justify-center mt-1">{enemyUnit.hp}</span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
      
      <div className="text-slate-400 text-sm">
        {isHost ? "You are Player 1 (Bottom)" : "You are Player 2 (Bottom)"}
      </div>
    </div>
  );
}
