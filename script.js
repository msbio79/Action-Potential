const canvas = document.getElementById('sim-canvas');
const ctx = canvas.getContext('2d');
const container = document.getElementById('canvas-container');

// 시각적 설정값
const CONFIG = {
    // Colors matching CSS variables
    colors: {
        na: '#FF4757',
        k: '#FFA502',
        pump: '#9B59B6',
        nach: '#FF6B81',
        kch: '#ECCC68',
        lipidHead: '#94A3B8',
        lipidTail: '#475569',
        membraneBg: 'rgba(15, 23, 42, 0.4)',
        bgExtracellular: 'rgba(56, 189, 248, 0.05)',
        bgIntracellular: 'rgba(167, 139, 250, 0.05)'
    },
    ionRadius: 9,
    membraneThickness: 140, // 세포막 두께
    membraneY: 0,           // 세포막 중심 Y좌표 설정 (캔버스 상대가 아님. 가상좌표계 원점)
    proteinWidth: 70
};

// 시뮬레이션 상태 관리
let simState = 'resting'; // resting, depolarization, repolarization, pump
let timeElapsed = 0;

// 화면 뷰포트 관리 (패닝, 줌)
let viewport = {
    x: 0,
    y: 0,
    scale: 1,
    minScale: 0.4,
    maxScale: 3.0
};

// 개체 데이터
let ions = [];
let proteins = [];

// 세포막 안팎 텍스트용 알파값
let externalCharge = '+';
let internalCharge = '-';

/**
 * 텍스트 데이터 
 */
const stepDescriptions = {
    'resting': "<strong>휴지 전위 (약 -70mV)</strong><br>Na⁺-K⁺ 펌프의 지속적인 활동으로 농도 기울기가 유지됩니다. 세포 밖은 Na⁺가 많아 대체로 <b>(+)전하</b>를, 안은 K⁺가 많고 단백질 음이온 등으로 인해 <b>(-)전하</b>를 띱니다. 통로는 닫혀있습니다.",
    'depolarization': "<strong>탈분극 (약 +35mV)</strong><br>역치 이상의 자극이 주어지면 <b>Na⁺ 통로가 열립니다.</b> 농도 차이에 의해 Na⁺가 세포 안으로 빠르게 확산되어 들어오면서, 세포 안쪽이 일시적으로 <b>(+)전하</b>로 역전됩니다.",
    'repolarization': "<strong>재분극</strong><br>Na⁺ 통로가 닫히고, 이어서 <b>K⁺ 통로가 열립니다.</b> 세포 안의 K⁺가 세포 밖으로 확산되어 나가면서, 다시 밖이 <b>(+)전하</b>, 안이 <b>(-)전하</b>로 돌아갑니다.",
    'pump': "<strong>이온 재배치 (능동 수송)</strong><br>확산으로 인해 바뀐 이온의 위치를 원래대로 되돌리기 위해 <b>Na⁺-K⁺ 펌프</b>가 ATP(에너지)를 소모합니다. Na⁺ 3개를 밖으로, K⁺ 2개를 안으로 이동시킵니다."
};

/**
 * 초기화 및 리사이즈
 */
function resize() {
    const dpr = window.devicePixelRatio || 1;
    // 컨테이너 크기 기반
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    
    // CSS 렌더링 크기
    canvas.style.width = `${container.clientWidth}px`;
    canvas.style.height = `${container.clientHeight}px`;
    
    ctx.scale(dpr, dpr);
    
    // 뷰포트 중앙 정렬 시도 (최초 실행시)
    if (viewport.x === 0 && viewport.y === 0) {
        viewport.x = container.clientWidth / 2;
        viewport.y = container.clientHeight / 2;
        
        // 반응형 스케일 조절 (모바일 화면일 경우 조금 축소)
        if (container.clientWidth < 600) {
            viewport.scale = 0.6;
        } else {
            viewport.scale = 1.0;
        }
    }
}

window.addEventListener('resize', resize);

/**
 * 시뮬레이션 모델 생성
 */
function initSimulation() {
    ions = [];
    proteins = [];
    
    // 단백질 생성 (x위치는 가상 좌표계)
    proteins.push({ type: 'nach', x: -200, width: CONFIG.proteinWidth, state: 'closed' });
    proteins.push({ type: 'pump', x: 0, width: CONFIG.proteinWidth + 20, state: 'active' });
    proteins.push({ type: 'kch', x: 200, width: CONFIG.proteinWidth, state: 'closed' });

    // 이온 생성: 나트륨 30개, 칼륨 20개로 설정 (3:2 펌프 비율을 맞추기 위함)
    for (let i = 0; i < 30; i++) {
        // Na+ (초기: 27 밖, 3 안)
        let isOutNa = i < 27;
        let posNa = getRandomPos(isOutNa);
        ions.push({
            id: `na_${i}`, type: 'na',
            x: posNa.x, y: posNa.y,
            targetX: posNa.x, targetY: posNa.y,
            isOutside: isOutNa,
            vx: 0, vy: 0
        });
    }
    for (let i = 0; i < 20; i++) {
        // K+ (초기: 2 밖, 18 안)
        let isOutK = i < 2;
        let posK = getRandomPos(isOutK);
        ions.push({
            id: `k_${i}`, type: 'k',
            x: posK.x, y: posK.y,
            targetX: posK.x, targetY: posK.y,
            isOutside: isOutK,
            vx: 0, vy: 0
        });
    }
}

function getRandomPos(isOutside) {
    const rangeX = 1200; // 가로 확산 범위
    const rangeY = 400;  // 세로 확산 범위
    const offset = CONFIG.membraneThickness / 2 + 30; // 막에서 떨어진 거리
    
    let x = (Math.random() - 0.5) * rangeX;
    
    // 외부는 위쪽(음수 Y), 내부는 아래쪽(양수 Y)
    let y = isOutside 
        ? -offset - Math.random() * rangeY 
        : offset + Math.random() * rangeY;
        
    return { x, y };
}

/**
 * 상태 변경 함수 
 */
function setStep(step) {
    simState = step;
    
    // UI 업데이트
    document.querySelectorAll('.step-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.step === step);
    });
    
    const statusContent = document.getElementById('status-content');
    statusContent.innerHTML = stepDescriptions[step];
    
    // 단백질 상태 세팅
    const nach = proteins.find(p => p.type === 'nach');
    const kch = proteins.find(p => p.type === 'kch');
    
    if (step === 'resting') {
        nach.state = 'closed';
        kch.state = 'closed';
        externalCharge = '+';
        internalCharge = '-';
        setIonsTargetDistribution('na', 27);
        setIonsTargetDistribution('k', 2);
    } 
    else if (step === 'depolarization') {
        nach.state = 'open';
        kch.state = 'closed';
        externalCharge = '-';
        internalCharge = '+';
        // Na+가 일부 유입되지만 여전히 밖이 더 많게 (밖: 20, 안: 10)
        setIonsTargetDistribution('na', 20);
        setIonsTargetDistribution('k', 2);
    }
    else if (step === 'repolarization') {
        nach.state = 'closed';
        kch.state = 'open';
        externalCharge = '+';
        internalCharge = '-';
        // K+가 일부 유출되지만 여전히 안이 더 많게 (밖: 7, 안: 13)
        setIonsTargetDistribution('na', 20);
        setIonsTargetDistribution('k', 7);
    }
    else if (step === 'pump') {
        nach.state = 'closed';
        kch.state = 'closed';
        // 펌프 작용: 비율에 맞춰 Na+ 15개 밖으로, K+ 10개 안으로 이동하여 휴지 전위 복구
        setIonsTargetDistribution('na', 27);
        setIonsTargetDistribution('k', 2);
    }
    
    updateChargeMarkersTarget(step);
}

// 목표 밖 이온 개수에 맞춰 이온 위치 재분배 (방향성 유지)
function setIonsTargetDistribution(type, targetOutsideCount) {
    let typeIons = ions.filter(i => i.type === type);
    let currentOutside = typeIons.filter(i => i.isOutside);
    let currentInside = typeIons.filter(i => !i.isOutside);
    
    let currentOutsideCount = currentOutside.length;
    
    if (currentOutsideCount < targetOutsideCount) {
        // 밖이 부족하므로 안에서 밖으로 내보냄 (예: 펌프 나트륨, 재분극 칼륨)
        let toMoveOutCount = targetOutsideCount - currentOutsideCount;
        currentInside.sort(() => 0.5 - Math.random());
        for (let i = 0; i < Math.min(toMoveOutCount, currentInside.length); i++) {
            let ion = currentInside[i];
            ion.isOutside = true;
            let p = getRandomPos(true);
            ion.targetX = p.x;
            ion.targetY = p.y;
        }
    } else if (currentOutsideCount > targetOutsideCount) {
        // 밖이 너무 많으므로 밖에서 안으로 들여보냄 (예: 탈분극 나트륨, 펌프 칼륨)
        let toMoveInCount = currentOutsideCount - targetOutsideCount;
        currentOutside.sort(() => 0.5 - Math.random());
        for (let i = 0; i < Math.min(toMoveInCount, currentOutside.length); i++) {
            let ion = currentOutside[i];
            ion.isOutside = false;
            let p = getRandomPos(false);
            ion.targetX = p.x;
            ion.targetY = p.y;
        }
    }
}

/**
 * 렌더링 루프 (애니메이션)
 */
let lastTime = performance.now();
function render(time) {
    const dt = time - lastTime;
    lastTime = time;
    timeElapsed += dt;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    // 캔버스 중앙이 아닌 viewport 좌표와 scale에 맞게 변환
    ctx.translate(viewport.x, viewport.y);
    ctx.scale(viewport.scale, viewport.scale);
    
    drawBackground();
    drawMembrane();
    updateAndDrawIons(dt);
    drawProteins();
    drawCharges();
    
    ctx.restore();
    
    // 그래프 UI 업데이트
    let _timeScale = Math.min(dt / 16.6, 2.0);
    graphTime += (graphTargets[simState] - graphTime) * 0.03 * _timeScale;
    drawGraph();
    
    requestAnimationFrame(render);
}

// ------------------------------------
// 그래프 렌더링 로직
// ------------------------------------
const graphTargets = {
    'resting': 0.15,
    'depolarization': 0.45,
    'repolarization': 0.65,
    'pump': 0.85
};
let graphTime = 0.15; // 0 ~ 1 범위

function getGraphYForTime(t) {
    if (t < 0.25) return -70;
    if (t < 0.45) { // 탈분극: -70 -> +35
        let p = (t - 0.25) / 0.2;
        p = p * p * (3 - 2 * p); // smooth step
        return -70 + p * 105;
    }
    if (t < 0.65) { // 재분극: +35 -> -80
        let p = (t - 0.45) / 0.2;
        p = p * p * (3 - 2 * p);
        return 35 - p * 115;
    }
    if (t < 0.85) { // 펌프 회복 (과분극 -> 휴지전위)
        let p = (t - 0.65) / 0.2;
        p = p * p * (3 - 2 * p);
        return -80 + p * 10;
    }
    return -70; // 안정 완료
}

function drawGraph() {
    const gCanvas = document.getElementById('graph-canvas');
    if(!gCanvas) return;
    const gCtx = gCanvas.getContext('2d');
    
    const dpr = window.devicePixelRatio || 1;
    const rect = gCanvas.parentElement.getBoundingClientRect();
    if (gCanvas.width !== rect.width * dpr || gCanvas.height !== rect.height * dpr) {
        gCanvas.width = rect.width * dpr;
        gCanvas.height = rect.height * dpr;
        gCtx.scale(dpr, dpr);
    }
    
    const w = rect.width;
    const h = rect.height;
    
    gCtx.clearRect(0, 0, w, h);
    
    // -100mV ~ +50mV를 캔버스 Y좌표로 변환 (여백 포함)
    const valToY = (val) => {
        const minV = -100;
        const maxV = 50;
        return h - ((val - minV) / (maxV - minV)) * h * 0.8 - h*0.1;
    };
    
    let scaleRatio = h / 250;
    let axisFontSize = Math.round(10 * scaleRatio);
    let valueFontSize = Math.round(13 * scaleRatio);

    gCtx.lineWidth = 1;
    // 0mV 표시선
    gCtx.strokeStyle = 'rgba(255,255,255,0.2)';
    gCtx.beginPath(); gCtx.moveTo(0, valToY(0)); gCtx.lineTo(w, valToY(0)); gCtx.stroke();
    gCtx.fillStyle = 'rgba(255,255,255,0.4)'; gCtx.font = `${axisFontSize}px Inter`; gCtx.fillText('0', 5, valToY(0)-3);
    
    // -70mV 표시선
    gCtx.strokeStyle = 'rgba(255,255,255,0.1)';
    gCtx.setLineDash([4, 4]);
    gCtx.beginPath(); gCtx.moveTo(0, valToY(-70)); gCtx.lineTo(w, valToY(-70)); gCtx.stroke();
    gCtx.setLineDash([]);
    gCtx.fillText('-70', 5, valToY(-70)-3);
    
    // 전위 곡선 렌더링
    gCtx.strokeStyle = '#3B82F6';
    gCtx.lineWidth = 2.5 * scaleRatio;
    gCtx.beginPath();
    const pts = 100;
    for(let i=0; i<=pts; i++) {
        let t = i / pts;
        let x = t * w;
        let y = valToY(getGraphYForTime(t));
        if(i===0) gCtx.moveTo(x, y);
        else gCtx.lineTo(x, y);
    }
    gCtx.stroke();
    
    // 현재 타이밍 인디케이터 그리기
    let currentMv = getGraphYForTime(graphTime);
    let indX = graphTime * w;
    let indY = valToY(currentMv);
    
    // 현재 단계 배경 표시
    gCtx.fillStyle = 'rgba(59, 130, 246, 0.1)';
    gCtx.fillRect(indX - w*0.05, 0, w*0.1, h);
    
    let indicatorRadius = 6 * scaleRatio;
    gCtx.beginPath();
    gCtx.arc(indX, indY, indicatorRadius, 0, Math.PI*2);
    gCtx.fillStyle = '#EF4444';
    gCtx.fill();
    gCtx.strokeStyle = '#ffffff';
    gCtx.lineWidth = 2 * scaleRatio;
    gCtx.stroke();
    
    // 현재 전위(-mV) 텍스트 
    gCtx.fillStyle = '#ffffff';
    gCtx.font = `bold ${valueFontSize}px Inter`;
    gCtx.textAlign = 'right';
    
    let textStr = `${Math.round(currentMv)} mV`;
    let textWidth = gCtx.measureText(textStr).width;
    let textX = indX - 12 * scaleRatio;
    
    // 텍스트가 왼쪽으로 너무 치우쳐 잘리는 걸 방지 (오른쪽으로 옮김)
    if (textX - textWidth < 10) { 
        textX = indX + 12 * scaleRatio; 
        gCtx.textAlign = 'left'; 
    }
    
    // 혹시라도 오른쪽 화면 밖으로 넘어가면 다시 왼쪽으로
    if (gCtx.textAlign === 'left' && (textX + textWidth) > w - 10) {
        textX = indX - 12 * scaleRatio;
        gCtx.textAlign = 'right';
    }
    
    gCtx.fillText(textStr, textX, indY + (valueFontSize * 0.3));
}

// 배경 그리기
function drawBackground() {
    const span = 3000; // 넓은 영역
    
    // Extracellular (상단)
    ctx.fillStyle = CONFIG.colors.bgExtracellular;
    ctx.fillRect(-span/2, -span/2, span, span/2 - CONFIG.membraneThickness/2);
    
    // Intracellular (하단)
    ctx.fillStyle = CONFIG.colors.bgIntracellular;
    ctx.fillRect(-span/2, CONFIG.membraneThickness/2, span, span/2);
    
    // 텍스트 라벨 (가상 배경에 고정)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '700 28px "Noto Sans KR"';
    ctx.textAlign = 'center';
    ctx.letterSpacing = '5px';
    // 세포막에서 더 멀리 배치 (기존 -120 -> -220, 150 -> 250)
    ctx.fillText('세포 밖 (Extracellular fluid)', 0, -CONFIG.membraneThickness/2 - 220);
    ctx.fillText('세포 안 (Intracellular fluid)', 0, CONFIG.membraneThickness/2 + 250);
}

// 인지질 이중층 그리기
function drawMembrane() {
    const w = 1600;
    const lipidRadius = 8;
    const spacing = 22; // 지질 간 간격
    
    // 막 내부 배경색을 옅게 채움
    ctx.fillStyle = CONFIG.colors.membraneBg;
    ctx.fillRect(-w/2, -CONFIG.membraneThickness/2, w, CONFIG.membraneThickness);
    
    for (let x = -w/2; x <= w/2; x += spacing) {
        // 단백질 위치에서는 그리지 않음
        let inProtein = proteins.some(p => Math.abs(x - p.x) < p.width/2 + 10);
        
        if (!inProtein) {
            // 미세하게 물결치는 효과 (사인파)
            let waveOffset = Math.sin(timeElapsed * 0.002 + x * 0.01) * 3;
            
            // 상단 머리 & 꼬리
            drawLipid(x, -CONFIG.membraneThickness/2 + waveOffset, true);
            // 하단 머리 & 꼬리
            drawLipid(x, CONFIG.membraneThickness/2 + waveOffset, false);
        }
    }
}

function drawLipid(x, y, isTop) {
    // 꼬리 (2가닥) 그리기
    const tailLen = CONFIG.membraneThickness / 2 - 10;
    const dir = isTop ? 1 : -1;
    
    ctx.beginPath();
    // 왼쪽 꼬리
    ctx.moveTo(x - 3, y + 8 * dir);
    // 꼬리 꾸불꾸불하게
    ctx.bezierCurveTo(
        x - 5, y + (tailLen/2) * dir, 
        x + 1, y + (tailLen/2) * dir, 
        x - 2, y + tailLen * dir
    );
    // 오른쪽 꼬리
    ctx.moveTo(x + 3, y + 8 * dir);
    ctx.bezierCurveTo(
        x + 5, y + (tailLen/2) * dir, 
        x - 1, y + (tailLen/2) * dir, 
        x + 2, y + tailLen * dir
    );
    
    ctx.strokeStyle = CONFIG.colors.lipidTail;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();

    // 머리 그리기
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = CONFIG.colors.lipidHead;
    ctx.fill();
    // 하이라이트
    ctx.beginPath();
    ctx.arc(x - 2, y - 2, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fill();
}

/**
 * 단백질 통로/펌프 그리기
 */
function drawProteins() {
    for (let p of proteins) {
        let x = p.x;
        let w = p.width;
        let h = CONFIG.membraneThickness + 20; // 밖으로 살짝 튀어나옴
        let y = 0;
        
        ctx.save();
        ctx.translate(x, y);
        
        // 펌프일 때
        if (p.type === 'pump') {
            ctx.fillStyle = CONFIG.colors.pump;
            // 둥근 캡슐 형태
            ctx.beginPath();
            ctx.roundRect(-w/2, -h/2, w, h, 20);
            ctx.fill();
            
            // 그림자/입체 효과
            let grad = ctx.createLinearGradient(-w/2, 0, w/2, 0);
            grad.addColorStop(0, 'rgba(0,0,0,0.3)');
            grad.addColorStop(0.5, 'rgba(255,255,255,0.1)');
            grad.addColorStop(1, 'rgba(0,0,0,0.3)');
            ctx.fillStyle = grad;
            ctx.fill();
            
            // 텍스트
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px Inter';
            ctx.textAlign = 'center';
            ctx.fillText('Na⁺-K⁺', 0, -10);
            ctx.fillText('Pump', 0, 10);
            
            // 동작 이펙트 (회전하는 링)
            if (simState === 'pump') {
                ctx.rotate(-timeElapsed * 0.002); // 반대 방향으로 회전
                ctx.strokeStyle = 'rgba(255,255,255,0.8)';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(0, 0, 25, 0.2, Math.PI - 0.2);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(0, 0, 25, Math.PI + 0.2, Math.PI*2 - 0.2);
                ctx.stroke();
                
                // 화살표 머리
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.moveTo(25, -5); ctx.lineTo(32, 5); ctx.lineTo(18, 5); ctx.fill();
                ctx.beginPath();
                ctx.moveTo(-25, 5); ctx.lineTo(-32, -5); ctx.lineTo(-18, -5); ctx.fill();
            }
        } 
        // 이온 통로일 때 (새로운 유선형 곡선 디자인)
        else {
            let color = p.type === 'nach' ? CONFIG.colors.nach : CONFIG.colors.kch;
            let name = p.type === 'nach' ? 'Na⁺ 통로' : 'K⁺ 통로';
            
            ctx.lineCap = 'round';
            
            // 기둥(서브유닛) 하나를 그리는 함수
            const drawGatePillar = (isLeft) => {
                ctx.beginPath();
                let dir = isLeft ? -1 : 1;
                let startX = dir * (w/2 - 10);
                
                if (p.state === 'closed') {
                    // 중앙으로 모이며 휘어지게 (문이 닫힌 모습)
                    ctx.moveTo(startX, -h/2.2);
                    ctx.quadraticCurveTo(dir * 2, 0, startX, h/2.2);
                } else {
                    // 수직 튜브 통로 (열림)
                    ctx.moveTo(dir * 18, -h/2.2);
                    ctx.lineTo(dir * 18, h/2.2);
                }
            };
            
            // 1. 외곽 그림자 효과 (매우 두꺼운 선)
            ctx.lineWidth = 26;
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            drawGatePillar(true); ctx.stroke();
            drawGatePillar(false); ctx.stroke();

            // 2. 단백질 본체 색상
            ctx.lineWidth = 20;
            ctx.strokeStyle = color;
            drawGatePillar(true); ctx.stroke();
            drawGatePillar(false); ctx.stroke();
            
            // 3. 단백질 광택(하이라이트) 효과로 입체감 강화
            ctx.lineWidth = 6;
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            drawGatePillar(true); ctx.stroke();
            drawGatePillar(false); ctx.stroke();
            
            // 텍스트 라벨
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px Inter';
            ctx.textAlign = 'center';
            ctx.fillText(name, 0, -h/2 - 15);
            
            // 열려있을 때 쏟아지는 입자 이동 이펙트
            if (p.state !== 'closed') {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                let offset = (timeElapsed * 0.05) % 20;
                let isDown = p.type === 'nach';
                
                for(let i=0; i<3; i++) {
                    let arrowY = isDown ? -20 + i*20 + offset : 20 - i*20 - offset;
                    drawDownArrow(0, arrowY, isDown);
                }
            }
        }
        ctx.restore();
    }
}

function drawDownArrow(x, y, isDown) {
    ctx.beginPath();
    if(isDown) {
        ctx.moveTo(x, y-5); ctx.lineTo(x, y+5);
        ctx.moveTo(x-4, y+1); ctx.lineTo(x, y+5); ctx.lineTo(x+4, y+1);
    } else {
        ctx.moveTo(x, y+5); ctx.lineTo(x, y-5);
        ctx.moveTo(x-4, y-1); ctx.lineTo(x, y-5); ctx.lineTo(x+4, y-1);
    }
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
}

/**
 * 이온 위치 업데이트 및 렌더링
 */
function updateAndDrawIons(dt) {
    const timeScale = Math.min(dt / 16.6, 2.0); // 프레임 드랍 보정, 최대 2배 보정
    
    for (let ion of ions) {
        let isMoving = Math.abs(ion.y - ion.targetY) > 5;
        
        // 이동 알고리즘
        if (isMoving) {
            // 통로 위치 계산
            let isChanneling = false;
            let targetProtX = ion.x;
            
            if (simState === 'depolarization' && ion.type === 'na' && Math.sign(ion.targetY) !== Math.sign(ion.y)) {
                targetProtX = proteins.find(p=>p.type==='nach').x;
                isChanneling = true;
            } else if (simState === 'repolarization' && ion.type === 'k' && Math.sign(ion.targetY) !== Math.sign(ion.y)) {
                targetProtX = proteins.find(p=>p.type==='kch').x;
                isChanneling = true;
            } else if (simState === 'pump' && Math.sign(ion.targetY) !== Math.sign(ion.y)) {
                targetProtX = proteins.find(p=>p.type==='pump').x;
                isChanneling = true;
            }
            
            // 막 통과 영역 (-170 ~ 170)에서는 통로 쪽으로 모임 (약간씩 겹치지 않게 분산)
            if (isChanneling && Math.abs(ion.y) < CONFIG.membraneThickness * 1.5) {
                let indexOffset = (ion.id.charCodeAt(ion.id.length-1) % 10 - 4.5) * 6;
                let dx = (targetProtX + indexOffset) - ion.x;
                // 스프링-댐퍼 효과
                ion.vx = (ion.vx + dx * 0.05) * 0.8; 
                ion.x += ion.vx * timeScale;
                
                // 막 통과 속도
                ion.vy = Math.sign(ion.targetY - ion.y) * 4;
            } else {
                // 막 밖에서는 목표지점 X,Y를 향해 이동 (너무 긴 일렬 방지)
                if (Math.abs(ion.x - ion.targetX) > 5) {
                    ion.vx = (ion.targetX - ion.x) * 0.01;
                    ion.x += ion.vx * timeScale;
                }
                ion.vy = (ion.targetY - ion.y) * 0.05;
                if(Math.abs(ion.vy) < 2) ion.vy = Math.sign(ion.targetY - ion.y) * 2;
            }
            
            ion.y += ion.vy * timeScale;
        } 
        else {
            // 브라운 운동 (자연스러운 흔들림)
            ion.x += (Math.random() - 0.5) * 1.5 * timeScale;
            ion.y += (Math.random() - 0.5) * 1.5 * timeScale;
            // 타겟 중심에서 너무 벗어나지 않게
            ion.x += (ion.x > 800 ? -2 : (ion.x < -800 ? 2 : 0));
        }

        // 그리기 (구형 이온 효과)
        ctx.beginPath();
        ctx.arc(ion.x, ion.y, CONFIG.ionRadius, 0, Math.PI * 2);
        
        let fillColor = ion.type === 'na' ? CONFIG.colors.na : CONFIG.colors.k;
        
        // 입체 효과
        let radGrad = ctx.createRadialGradient(
            ion.x - 3, ion.y - 3, 1,
            ion.x, ion.y, CONFIG.ionRadius
        );
        radGrad.addColorStop(0, '#ffffff');
        radGrad.addColorStop(0.3, fillColor);
        radGrad.addColorStop(1, '#000000'); // 너무 어두우면 수정
        
        // Custom mix
        ctx.fillStyle = fillColor; 
        ctx.fill();
        
        // 테두리
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.stroke();

        // 텍스트 '+' (시각적 중앙 배치를 위해 Y축 오프셋을 +1로 조정)
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('+', ion.x, ion.y + 1);
    }
}

let chargeMarkers = [];

function drawCharges() {
    ctx.font = '900 60px Inter, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 1.0;
    
    // 글로우 색상 정의
    const glowColorPlus = 'rgba(255, 71, 87, 0.7)';
    const glowColorMinus = 'rgba(56, 189, 248, 0.7)';
    const pulseScale = 1.0 + Math.sin(timeElapsed * 0.005) * 0.08;

    chargeMarkers.forEach(m => {
        // 부드러운 위치 이동 (Lerp)
        m.y += (m.targetY - m.y) * 0.1;
        
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.scale(pulseScale, pulseScale);
        
        // 기호에 따른 글로우 설정
        ctx.shadowColor = m.type === '+' ? glowColorPlus : glowColorMinus;
        ctx.shadowBlur = 20;
        ctx.fillStyle = '#FFFFFF';
        
        ctx.fillText(m.type, 0, 0);
        ctx.restore();
    });
    
    ctx.shadowBlur = 0;
}

/**
 * UI 인터랙션 (Zoom, Pan 설정)
 */

// 버튼 클릭 이벤트
document.querySelector('.steps-container').addEventListener('click', (e) => {
    // btn을 클릭했는지 확인 (자식 요소 클릭 방지)
    const btn = e.target.closest('.step-btn');
    if (btn) {
        setStep(btn.dataset.step);
    }
});

function applyZoom(factor, centerX, centerY) {
    const minS = viewport.minScale;
    const maxS = viewport.maxScale;
    let newScale = viewport.scale * factor;
    
    if (newScale < minS) newScale = minS;
    if (newScale > maxS) newScale = maxS;
    
    // 중심점 기준으로 스케일 조정 (수학 공식 적용)
    viewport.x = centerX - (centerX - viewport.x) * (newScale / viewport.scale);
    viewport.y = centerY - (centerY - viewport.y) * (newScale / viewport.scale);
    viewport.scale = newScale;
}

// 줌 컨트롤 버튼
document.getElementById('zoom-in').addEventListener('click', () => {
    applyZoom(1.3, container.clientWidth / 2, container.clientHeight / 2);
});
document.getElementById('zoom-out').addEventListener('click', () => {
    applyZoom(1 / 1.3, container.clientWidth / 2, container.clientHeight / 2);
});
document.getElementById('zoom-reset').addEventListener('click', () => {
    // 뷰포트 완전 초기화
    viewport.scale = container.clientWidth < 600 ? 0.6 : 1.0;
    viewport.x = container.clientWidth / 2;
    viewport.y = container.clientHeight / 2;
});

// 전위 그래프 크게 보기 버튼
document.getElementById('graph-expand-btn')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const sidebar = btn.closest('.right-sidebar');
    if (sidebar) {
        sidebar.classList.toggle('expanded');
        if (sidebar.classList.contains('expanded')) {
            btn.innerHTML = '🔍 작게 보기';
        } else {
            btn.innerHTML = '🔍 크게 보기';
        }
    }
});

// 마우스 (웹 디스크탑) 조작
let isDragging = false;
let startDrag = { x: 0, y: 0 };

canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    startDrag.x = e.clientX - viewport.x;
    startDrag.y = e.clientY - viewport.y;
    container.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', (e) => {
    if (isDragging) {
        viewport.x = e.clientX - startDrag.x;
        viewport.y = e.clientY - startDrag.y;
    }
});

window.addEventListener('mouseup', () => {
    isDragging = false;
    container.style.cursor = 'grab';
});

// 마우스 휠 설정
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9; 
    // 마우스 포인터 위치 기준
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    applyZoom(factor, mouseX, mouseY);
}, { passive: false });


// 모바일 터치 제스처 (핀치 줌 / 더블 터치 팬)
let lastPinchDist = null;
let lastPinchCenter = null;

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
        // 단일 터치 -> 팬닝
        isDragging = true;
        startDrag.x = e.touches[0].clientX - viewport.x;
        startDrag.y = e.touches[0].clientY - viewport.y;
    } else if (e.touches.length === 2) {
        isDragging = false;
        lastPinchDist = getPinchDist(e.touches[0], e.touches[1]);
        lastPinchCenter = getPinchCenter(e.touches[0], e.touches[1]);
    }
}, {passive: false});

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && isDragging) {
        viewport.x = e.touches[0].clientX - startDrag.x;
        viewport.y = e.touches[0].clientY - startDrag.y;
    } else if (e.touches.length === 2) {
        const curDist = getPinchDist(e.touches[0], e.touches[1]);
        const curCenter = getPinchCenter(e.touches[0], e.touches[1]);
        
        if (lastPinchDist && lastPinchCenter) {
            // 스케일 줌
            const scaleRatio = curDist / lastPinchDist;
            const rect = canvas.getBoundingClientRect();
            
            // 캔버스 상대 좌표로 중심점 계산
            const centerX = lastPinchCenter.x - rect.left;
            const centerY = lastPinchCenter.y - rect.top;
            
            applyZoom(scaleRatio, centerX, centerY);
            
            // 두 손가락 드래그 (팬)
            viewport.x += (curCenter.x - lastPinchCenter.x);
            viewport.y += (curCenter.y - lastPinchCenter.y);
        }
        
        lastPinchDist = curDist;
        lastPinchCenter = curCenter;
    }
}, {passive: false});

canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (e.touches.length < 2) {
        lastPinchDist = null;
        lastPinchCenter = null;
    }
    if (e.touches.length === 1) {
        // 한 손가락 떼고 하나 남았을 때도 자연스레 팬 연결
        isDragging = true;
        startDrag.x = e.touches[0].clientX - viewport.x;
        startDrag.y = e.touches[0].clientY - viewport.y;
    } else if (e.touches.length === 0) {
        isDragging = false;
    }
});

function getPinchDist(t1, t2) {
    return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
}

function getPinchCenter(t1, t2) {
    return {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2
    };
}

// ------------------------------------
// 초기 실행 부
// ------------------------------------
resize();
initSimulation();
initChargeMarkers(); // 전하 기호 초기화
setStep('resting'); // 초기 상태 세팅
requestAnimationFrame(render);

function initChargeMarkers() {
    chargeMarkers = [];
    const spacing = 180;
    const topY = -CONFIG.membraneThickness/2 - 40;
    const bottomY = CONFIG.membraneThickness/2 + 55;
    
    for (let x = -1000; x <= 1000; x += spacing) {
        if (proteins.some(p => Math.abs(x - p.x) < p.width + 10)) continue;
        
        chargeMarkers.push({
            x: x,
            type: '+',
            y: topY,
            targetY: topY
        });
        
        chargeMarkers.push({
            x: x,
            type: '-',
            y: bottomY,
            targetY: bottomY
        });
    }
}

function updateChargeMarkersTarget(step) {
    const topY = -CONFIG.membraneThickness/2 - 40;
    const bottomY = CONFIG.membraneThickness/2 + 55;
    const isReversed = (step === 'depolarization');
    
    chargeMarkers.forEach(m => {
        if (m.type === '+') {
            m.targetY = isReversed ? bottomY : topY;
        } else {
            m.targetY = isReversed ? topY : bottomY;
        }
    });
}
