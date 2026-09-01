# CAELUS USB 포터블 작업환경 — 종합 설계 문서

Claude Code CLI 전달용. 이 문서 기준으로 구현 시작.

> 이 파일은 프로젝트에 전달된 원본 설계 문서를 그대로 보관한 참고용 사본입니다.
> 실제 구현/사용 안내는 저장소 루트의 `README.md`를 참고하세요.

---

## 1. 목표

USB 하나로 어느 Windows PC에서든 비설치로 Claude Code 기반 개인 AI 작업환경을 실행한다.
- 특정 PC에서는 USB 삽입 시 자동 실행
- 로그인 세션은 USB에 저장되어 PC를 이동해도 재로그인 불필요
- 화면(UI)은 커스텀 프로그램(CAELUS)이며, 실제 두뇌는 Claude Code CLI가 담당

---

## 2. 전체 아키텍처

```
[Electron UI: CAELUS]  ← 사용자가 보는 화면, 프론트엔드
        ↓ (child_process 또는 stdin/stdout 파이프)
[Claude Code CLI]      ← --print 모드, 실제 처리 엔진
        ↓
[Claude API]           ← 클라우드
```

- Electron UI는 입력을 받아 Claude Code CLI에 전달하고, 응답을 받아 커스텀 UI로 렌더링만 한다.
- 코드 실행, 파일 조작, 명령 처리는 전부 Claude Code CLI가 담당한다. UI와 엔진은 분리된 별개 프로세스다.

---

## 3. USB 폴더 구조

```
E:\PortableDev\
├── setup.bat              (최초 1회, 관리자 권한, PC에 자동실행 트리거 등록)
├── install_trigger.ps1    (작업 스케줄러 등록 스크립트)
├── find_usb_by_serial.ps1 (드라이브 문자 변동 대응, 볼륨 시리얼로 USB 재탐색)
├── start.bat               (실제 작업환경 진입점, HOME 리다이렉트 포함)
├── node\                   (Node.js portable)
├── git\                    (PortableGit)
├── electron-app\           (CAELUS UI 소스, 빌드 결과물)
├── claude-home\             (HOME 리다이렉트 대상, .claude 세션/인증 저장)
├── projects\               (작업 파일)
```

---

## 4. 단계별 구현 스펙

### 4-1. setup.bat / install_trigger.ps1 (1단계)

- 목적: 사용자가 setup.bat을 더블클릭하면, 해당 PC의 작업 스케줄러에 "USB 삽입 이벤트 → start.bat 실행" 트리거를 등록한다.
- 관리자 권한 필요 (UAC 팝업, 1회 승인).
- 트리거는 Event ID 2003 (Microsoft-Windows-DriverFrameworks-UserMode 로그) 기반.
- 트리거 조건에 해당 USB의 볼륨 시리얼 번호를 필터로 넣어, 다른 USB가 꽂혀도 무반응하고 지정된 USB에만 반응하도록 제한한다.
- 이 설정은 USB가 아니라 PC(로컬 작업 스케줄러)에 저장된다. 즉 "이 PC + 이 USB" 조합에서만 자동 실행되며, 다른 PC에서는 setup.bat을 다시 실행해야 한다.
- 실패 대응: 회사/공용 PC는 그룹정책으로 작업 스케줄러 등록이 막혀 있을 수 있다. 이 경우 setup.bat이 실패 메시지를 띄우고, start.bat 수동 실행 방식으로 폴백 안내한다.
- 드라이브 문자 변동 문제: USB를 다른 포트에 꽂으면 드라이브 문자가 바뀔 수 있으므로, 트리거 실행 시점에 find_usb_by_serial.ps1로 볼륨 시리얼 기준 실제 드라이브 문자를 재탐색한 뒤 start.bat 경로를 동적으로 구성한다.

### 4-2. start.bat — HOME 리다이렉트 (2단계, 필수 요구사항)

- 목적: Claude Code CLI의 인증/세션 정보가 시스템 기본 경로(`%USERPROFILE%\.claude`)가 아니라 USB 내부(`E:\PortableDev\claude-home`)에 저장되도록 한다.
- 구현: start.bat 실행 시 `HOME` 및 `USERPROFILE` 환경변수를 세션 한정으로 USB 경로로 재설정한 뒤 Claude Code CLI를 그 환경에서 실행한다.
- 효과: PC A에서 최초 1회 로그인하면 세션이 USB에 저장된다. 이후 PC B, C, D 등 어디에 꽂아도 start.bat 실행 시 이미 로그인된 상태로 바로 이어서 작업할 수 있다. 재로그인은 세션 만료 시에만 필요하다.
- 확인 필요 사항: HOME 강제 리다이렉트가 Claude Code CLI 내부 인증 로직(하드웨어 지문 체크 등)과 충돌하지 않는지 실제 테스트 1회로 검증한다.
- PATH는 시스템에 등록하지 않고 start.bat 세션 내에서만 임시로 설정한다. PC 재부팅 시 시스템에 흔적이 남지 않는다.

### 4-3. Electron UI — CAELUS (3단계)

- 스택: Electron (Node 기반, USB 내 Node portable과 궁합 좋음)
- 백엔드 연동: Claude Code CLI를 `--print` 모드로 child_process 호출, stdout으로 응답 수신
- UI 상태: 대기 / 음성 인식 중(또는 입력 중) / 응답 완료 3가지 최소 상태를 기본으로 구성
- 좌측 사이드바: 작업 기록 목록 (세션 내 대화 스레드)
- 중앙: 원형 상태 인디케이터 + 대화 영역
- 하단: 명령 입력 바

---

## 5. 데이터 모델 (ERD)

```
DEVICE ||--o{ SESSION : registers
SESSION ||--o{ TASK : contains
TASK ||--o{ LOG : generates

DEVICE
  volume_serial   PK
  pc_name
  registered_at

SESSION
  session_id      PK
  volume_serial   FK
  auth_token
  last_used

TASK
  task_id         PK
  session_id      FK
  title
  status

LOG
  log_id          PK
  task_id         FK
  content
  created_at
```

- DEVICE: 트리거가 등록된 PC (작업 스케줄러 종속)
- SESSION: USB 볼륨 시리얼에 귀속된 Claude Code 인증 세션
- TASK / LOG: 작업 단위와 그 실행 기록

---

## 6. UI 디자인 컨셉 — CAELUS (JARVIS 스타일)

### 6-1. 참고 방향
Iron Man JARVIS UI 참고. 원형 홀로그램 인디케이터, 네온 톤, 위젯형 정보 카드, 하단 명령/음성 입력 바.

### 6-2. 색상 팔레트 (실제 구현용, 하드코딩 hex)

| 용도 | 색상 | 의미 |
|---|---|---|
| 배경 | `#0b1220` | 다크 네이비 베이스 |
| 카드 배경 | `#111c2e` | 정보 카드 |
| 카드 테두리 | `#223247` | 얇은 구분선 |
| 대기 상태 | `#4fd1e0` / `#5ec8d8` | 청록, 평상시 |
| 인식/입력 중 | `#f2c34d` | 황색, 음성 인식·명령 입력 |
| 완료/성공 | `#6fd68a` | 초록, 응답 완료 |
| 본문 텍스트 | `#eaf6f8` | 밝은 흰색 계열 |
| 보조 텍스트 | `#5c6c80` | 회색 |

### 6-3. 상태 3종
1. **대기(Idle)**: 청록 링, "대기 중"
2. **입력 중(Listening/Typing)**: 황색 링, 파형 또는 타이핑 인디케이터
3. **응답 완료(Response)**: 초록 링, 응답 카드 + 액션 버튼

### 6-4. 네온/글로우 이펙트 관련 — 중요

앞서 보여드린 목업(claude.ai 내 프리뷰 위젯)은 디자인 시스템 제약상 `box-shadow`, `blur`, `glow` 계열 CSS를 사용할 수 없어 **플랫(테두리 선) 버전으로만 표현되었습니다.**

**실제 Electron 앱 코드에는 이 제약이 없습니다.** 아래 CSS로 원본 참고 이미지 수준의 네온 이펙트 구현이 가능합니다.

```css
.jarvis-ring {
  border: 2px solid #4fd1e0;
  border-radius: 50%;
  box-shadow:
    0 0 8px rgba(79, 209, 224, 0.6),
    0 0 24px rgba(79, 209, 224, 0.3),
    inset 0 0 12px rgba(79, 209, 224, 0.2);
}

.jarvis-ring.listening {
  border-color: #f2c34d;
  box-shadow:
    0 0 8px rgba(242, 195, 77, 0.6),
    0 0 24px rgba(242, 195, 77, 0.3);
  animation: pulse 1.6s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.03); opacity: 0.85; }
}
```

즉, 목업에서 못 보여준 글로우·펄스 애니메이션은 실제 구현 단계에서 100% 반영 가능합니다. Claude Code에게 이 문서와 함께 "참고 이미지 스타일의 box-shadow 기반 네온 이펙트 적용"을 명시적으로 지시하면 됩니다.

---

## 7. USB 하드웨어 스펙

- **용량**: 128GB (여유 있게)
- **타입**: 포터블 SSD (일반 플래시 USB 대비 랜덤 읽기/쓰기 성능 우수, 개발 작업 특성상 필수)
- **인터페이스**: USB-C 우선, A타입 겸용 케이블 동봉 제품 (예: 삼성 T7, 산디스크 익스트림 포터블 SSD)
- **참고**: 실제 속도는 꽂는 포트 규격(USB 2.0/3.0/3.1)에 따라 제한됨. SSD는 "최저 보장 속도"를 높여주는 역할이며, 구형 PC(USB 2.0)에서는 체감 차이가 작을 수 있음.

---

## 8. 미해결/검증 필요 항목

- [ ] HOME 리다이렉트와 Claude Code CLI 인증 로직 충돌 여부 실제 테스트
- [ ] 회사/공용 PC 그룹정책으로 작업 스케줄러 등록 차단 시 폴백 UX
- [ ] 안티바이러스의 포터블 node.exe 오탐 가능성 → 화이트리스트 안내 필요
- [ ] Electron 앱 용량 최적화 (USB 용량 대비 부담 여부)
