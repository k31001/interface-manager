# Interface Manager

SoC 하드웨어/소프트웨어 인터페이스(SFR · HAL)를 **보고, 비교하고, 추적**하는 웹앱.

- **SFR (Special Function Register)** — register-level interface. SystemRDL(`.rdl`)로 정의되고
  `<system>/<subsystem>/<ip>/<module>.rdl` 디렉토리 구조로 계층을 표현한다.
- **HAL (Hardware Abstraction Layer)** — function-level interface. C++ 헤더의 클래스 함수 선언과
  Doxygen 주석에서 API 문서를 만든다.

모든 인터페이스는 git으로 형상 관리되며, 앱은 repo 주소와 디렉토리만 설정하면
`git ls-tree / show`로 원하는 태그의 내용을 직접 읽어 파싱한다(워킹트리 체크아웃 없음).

## 실행

기본 설정([`data/config.json`](data/config.json))은 GitHub의 공개 샘플 SoC repo 3개를 가리키므로
바로 실행하면 된다(최초 접근 시 각 repo를 `data/cache/`에 bare clone 후 git으로 읽는다 — git CLI + 네트워크 필요).

```bash
npm install
npm run dev      # http://localhost:3000  ← Helios · Selene · Pulsar 세 과제가 바로 보인다
```

### 샘플 과제 repo

| 과제 | 설명 | repo |
| --- | --- | --- |
| Helios (AUR-H5000) | 플래그십 AP, 공격적 재설계 → 낮은 재사용율 | [k31001/helios-soc](https://github.com/k31001/helios-soc) |
| Selene (AUR-S3200) | 원가 절감 파생형 → 높은 재사용율 | [k31001/selene-soc](https://github.com/k31001/selene-soc) |
| Pulsar (AUR-P9100) | PCIe Gen5 / NVMe SSD 컨트롤러, 8개월 히스토리 | [k31001/pulsar-soc](https://github.com/k31001/pulsar-soc) |

### 로컬에서 과제 데이터 재생성 (선택)

```bash
npm run seed        # Helios · Selene 를 data/repos/ 에 생성하고 config.json 을 로컬 경로로 전환
npm run seed:ssd    # Pulsar 를 ../pulsar 에 생성
npm run verify      # 파서/통계 엔진으로 재사용율 스토리라인 검증
```

## 기능 ↔ 화면

| 기능 | 경로 | 내용 |
| --- | --- | --- |
| 1. SFR viewer | `/<project>/sfr` | 디렉토리 계층 트리, IP 클릭 시 한눈에 보는 register map(비트맵 테이블), 모듈 클릭 시 레지스터 단위 상세 테이블 |
| 2. SFR changelog | `/<project>/sfr/changelog` | 릴리스 타임라인 + tag-to-tag 비교. 레지스터/필드의 추가·삭제·변경(doc-only 구분) |
| 3. SFR statistics | `/<project>/sfr/stats` | 베이스라인(tag/commit) 대비 레지스터·필드 재사용율, 시간 추이, 급락 태그 경고 |
| 4. HAL viewer | `/<project>/hal` | API document 스타일. 클래스/함수 시그니처, 파라미터 표, return/note/warning/deprecated |
| 5. HAL changelog | `/<project>/hal/changelog` | 함수 단위 diff(시그니처 old/new), doc-only 변경 구분 |
| 6. HAL statistics | `/<project>/hal/stats` | 함수 재사용율 추이 + 경고 |
| 프로젝트 비교 | `/compare` | **상대 시간축**(각 과제의 initial commit = W0)으로 두 과제의 재사용율 곡선을 정렬해 비교, SFR→HAL 상관 산점도 |
| 대시보드 | `/` | 과제별 재사용율/스파크라인/경고/최근 커밋 피드 |
| 설정 | `/settings` | git repo(로컬 경로 또는 원격 URL), rdl/hal 디렉토리, 통계 베이스라인, 경고 임계값 |
| 검색 | `⌘K` | 전 과제의 레지스터·필드·HAL 함수 통합 검색 → 해당 위치로 점프 |

### 재사용율 정의

- 베이스라인(기본: 첫 태그 = 이전 과제에서 가져온 initial import)의 각 항목이 해당 태그에서
  **기능적으로 동일**하게 남아 있는 비율.
- 레지스터: offset/width/필드 구성(비트 범위·sw/hw 접근·reset)이 모두 같아야 재사용으로 계산.
- 필드: 비트 범위·접근·reset 동일 여부 (설명 변경은 doc-only로 재사용율에 영향 없음).
- HAL 함수: 시그니처(리턴 타입·파라미터 타입·const·deprecated 여부) 기준. 파라미터 이름/주석 변경은 doc-only.
- 연속 태그 사이 재사용율이 `warnThresholdPct`(기본 4pp) 이상 떨어지면 ⚠ 경고.

## 데모 과제 (npm run seed)

6개월치 그럴듯한 커밋/태그 히스토리를 가진 실제 git repo 두 개를 생성한다.

| | **Helios** (AUR-H5000) | **Selene** (AUR-S3200) |
| --- | --- | --- |
| 성격 | 차세대 플래그십 — 공격적 재설계 | 원가 절감 파생형 — 플랫폼 재사용 |
| 베이스라인 | Titan v1.0에서 import (2025-09-08) | Luna v2.1에서 import (2025-12-01) |
| 최종 SFR 재사용율 | **69.5%** (레지스터) / 84.9% (필드) | **89.2%** / 94.7% |
| 최종 HAL 재사용율 | **74.4%** | **92.5%** |
| 사건 | v0.5.0 `SEC-ARCH` 보안 아키텍처 개편 **−11.6pp** (crypto/otp/dma 집중 변경) | v0.4.0 `PWR-REMAP` PMIC 변경 **−4.8pp** (pmu/clkgen) |

두 과제의 타임라인이 달라 비교 화면은 절대 시간이 아닌 **initial commit 기준 상대 시간**으로 정렬한다.
SFR 재사용율이 높은 Selene은 HAL 재사용율도 높게 유지된다(HAL follows SFR).

## 아키텍처

```
data/config.json          프로젝트 설정 (Settings 화면에서 편집)
data/repos/*              데모 repo (npm run seed가 생성)
data/cache/*              원격 repo 설정 시 bare clone 캐시

src/lib/
  git.ts                  git ls-tree/show/for-each-ref 래퍼 + 원격 clone/fetch
  rdl.ts                  SystemRDL 서브셋 파서 (addrmap > reg > field)
  hal.ts                  C++ 헤더 + Doxygen 파서 (class > member function)
  model.ts                태그별 SFR/HAL 모델 로더 (sha 기준 in-memory 캐시)
  diff.ts                 기능적 동일성 판정 + 모듈/레지스터/필드/함수 diff
  stats.ts                재사용율 시계열 + 경고 산출
  search.ts               통합 검색 인덱스

src/app/api/*             REST 엔드포인트 (config, tags, sfr, hal, diff, stats, search, overview)
src/components/*          regmap 비트테이블, 순수 SVG 차트, 뷰어/체인지로그/통계/비교 화면
scripts/seed.ts           데모 repo 생성기 (커밋 시나리오 + 재사용율 궤적 시뮬레이션)
scripts/verify.ts         시드 데이터가 의도한 스토리라인인지 assert
```

### Register map 표기 규칙

- 필드는 비트 폭만큼 컬럼을 병합해 표시, 사용하지 않는 비트는 사선 해칭.
- 1–2비트 필드는 세로 텍스트, 그 외는 가로 텍스트.
- 칸에 비해 이름이 길면 단계적으로 축약: 모음 제거(`STOP_BITS→STP_BITS`) → 토큰 절단 → 이니셜.
  전체 이름·비트범위·접근·reset·설명은 hover 툴팁으로 항상 확인 가능.
