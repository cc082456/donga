# GitHub Actions 기반 DORA Metrics

GitHub REST API에서 배포/커밋/incident 이슈를 수집하고 Chart.js 대시보드로 보여주는 Python 기반 스타터 프로젝트입니다.

## DORA 4대 지표 정의

| 지표 | 이 프로젝트의 계산 방식 | 데이터 소스 |
|---|---|---|
| Lead Time for Changes | 커밋 작성 시각 → 성공한 production 배포 상태 시각의 중앙값(시간) | Commits + Deployments |
| Deployment Frequency | 최근 30일 성공 production 배포 수 ÷ 30(일) | Deployments |
| MTTR | `incident` 라벨이 붙은 종료 이슈의 생성 → 종료 시간 중앙값(시간) | Issues |
| Change Failure Rate | 실패/오류 production 배포 수 ÷ 전체 production 배포 수 × 100 | Deployments |

> 팀마다 DORA 지표 정의가 다를 수 있습니다. 이 구현은 교육용 MVP이며, Lead Time은 커밋 작성 시간을 기준으로 한 근사치입니다. 정확한 변경 리드 타임은 PR 병합 시각/배포 포함 커밋과 연결하도록 개선할 수 있습니다.

## 실행 방법

1. 이 저장소에 파일을 복사하고 기본 브랜치를 `main`으로 설정합니다.
2. `.github/workflows/deploy.yml`의 예제 배포 단계를 실제 배포 명령으로 교체합니다. 이 워크플로우는 성공 시 GitHub Deployments API에 `production` 배포 기록을 만듭니다.
3. GitHub 저장소의 **Settings → Actions → General → Workflow permissions**에서 `Read and write permissions`를 허용합니다. 조직 정책이 쓰기를 제한하면 관리자 승인이 필요할 수 있습니다.
4. 이슈에서 사고/장애 이슈에 `incident` 라벨을 붙이고, 해결 시 닫습니다.
5. **Actions → Collect DORA metrics → Run workflow**를 실행합니다. 매일 UTC 02:17에도 자동 실행됩니다.
6. 로컬에서 대시보드를 보려면 저장소 루트에서 실행합니다.

```bash
python -m http.server 8000
```

브라우저에서 `http://localhost:8000/dashboard/`를 엽니다. 정적 파일 `fetch()`는 로컬 HTTP 서버에서 실행해야 합니다.

## 저장소에 README 이미지 첨부하기

대시보드 HTML은 `dashboard/index.html`입니다. 브라우저에서 열고 화면 캡처를 `docs/dora-dashboard.png`로 저장한 뒤 아래 내용을 README에 추가할 수 있습니다.

```markdown
## Dashboard preview

![DORA Metrics Dashboard](docs/dora-dashboard.png)
```

이미지 파일을 GitHub 저장소에 커밋하면 README에서 자동 표시됩니다. (이 스타터 ZIP은 실제 GitHub 저장소에 직접 업로드하지는 않습니다.)

## 폴더 구조

```text
.
├── .github/workflows/
│   ├── deploy.yml
│   └── dora-metrics.yml
├── scripts/collect_dora.py
├── dashboard/
│   ├── index.html
│   └── metrics.json
└── README.md
```

## MVP 한계 / 다음 개선

- GitHub Deployments API에 기록된 배포만 계산합니다. 실제 배포 파이프라인이 별도라면 해당 파이프라인에서 deployment record를 생성해야 합니다.
- 현재 수집기는 최근 최대 500개 배포 및 이슈를 확인합니다.
- MTTR은 `incident` 라벨이 붙은 닫힌 이슈의 생성~종료 시간으로 계산합니다. 실제 서비스 복구 시각을 이슈 종료와 동일시하면 오차가 날 수 있습니다.
- 실패한 배포도 Deployments API에 `failure` 또는 `error` 상태를 기록하도록 배포 워크플로우에 실패 처리 단계를 추가해야 CFR이 의미 있어집니다.
- `dashboard/metrics.json`은 Actions가 커밋하므로 workflow permissions가 쓰기 가능해야 합니다. 브랜치 보호 규칙이 있으면 별도 PAT 또는 artifact/Pages 배포 방식이 필요할 수 있습니다.
- 외부 Chart.js CDN을 사용하므로 대시보드를 오프라인에서 보려면 Chart.js를 로컬에 포함하세요.

## 검증

```bash
python -m py_compile scripts/collect_dora.py
```

GitHub Actions 실행 후 `dashboard/metrics.json`이 실제 저장소 데이터로 바뀌는지 확인하세요.
