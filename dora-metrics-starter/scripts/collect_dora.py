"""Collect lightweight DORA metrics from GitHub REST API.

Conventions:
- Deployment = a GitHub Deployment record in production environment.
- Lead time = commit authored time to successful deployment status time.
- MTTR = median time from opening to closing issues labelled 'incident'.
- Change failure rate = failed production deployment records / all production deployments.
These are practical proxies; adjust labels/environment to match your team's process.
"""
import json
import os
import statistics
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = os.environ["GITHUB_REPOSITORY"]
TOKEN = os.environ["GH_TOKEN"]
API = "https://api.github.com"
OUT = Path("dashboard/metrics.json")


def api_get(path, params=None):
    url = API + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {TOKEN}",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "dora-metrics-starter",
    })
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def pages(path, params=None, max_pages=5):
    params = dict(params or {})
    params["per_page"] = 100
    result = []
    for page in range(1, max_pages + 1):
        params["page"] = page
        batch = api_get(path, params)
        if not batch:
            break
        result.extend(batch)
        if len(batch) < 100:
            break
    return result


def parse_dt(value):
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def hours(delta):
    return round(delta.total_seconds() / 3600, 2)


def main():
    now = datetime.now(timezone.utc)
    deployments = pages(f"/repos/{REPO}/deployments", {"environment": "production"})
    deploy_rows = []
    for dep in deployments:
        try:
            statuses = pages(f"/repos/{REPO}/deployments/{dep['id']}/statuses", max_pages=1)
            latest = statuses[0] if statuses else {}
            state = latest.get("state", "pending")
            stamp = parse_dt(latest.get("created_at") or dep.get("created_at"))
            commit = api_get(f"/repos/{REPO}/commits/{dep['sha']}")
            authored = parse_dt(commit["commit"]["author"]["date"])
            deploy_rows.append({
                "id": dep["id"], "sha": dep["sha"][:7], "environment": dep.get("environment"),
                "state": state, "time": stamp.isoformat() if stamp else None,
                "lead_time_hours": hours(stamp - authored) if stamp and authored and stamp >= authored else None,
            })
        except (urllib.error.HTTPError, KeyError, TypeError, ValueError):
            continue

    prod = [d for d in deploy_rows if d.get("environment") == "production"]
    successful = [d for d in prod if d["state"] == "success"]
    failed = [d for d in prod if d["state"] in ("failure", "error")]
    lead_times = [d["lead_time_hours"] for d in successful if d["lead_time_hours"] is not None]

    issues = pages(f"/repos/{REPO}/issues", {"state": "closed", "labels": "incident", "since": (now.replace(day=1)).isoformat()})
    mttr_hours = []
    for issue in issues:
        if "pull_request" in issue:
            continue
        created, closed = parse_dt(issue.get("created_at")), parse_dt(issue.get("closed_at"))
        if created and closed and closed >= created:
            mttr_hours.append(hours(closed - created))

    metrics = {
        "generated_at": now.isoformat(),
        "repository": REPO,
        "definitions": {
            "lead_time": "Commit author timestamp → successful production deployment status (hours; median)",
            "deployment_frequency": "Successful production deployments per day in the last 30 days",
            "mttr": "Median opened-to-closed duration for issues labelled 'incident' (hours; current month query)",
            "change_failure_rate": "Failed/error production deployment records ÷ all production deployment records",
        },
        "summary": {
            "lead_time_hours_median": round(statistics.median(lead_times), 2) if lead_times else None,
            "deployment_frequency_per_day_30d": round(sum(
                1 for d in successful if d.get("time") and (now - parse_dt(d["time"])).total_seconds() <= 30 * 86400
            ) / 30, 3),
            "mttr_hours_median": round(statistics.median(mttr_hours), 2) if mttr_hours else None,
            "change_failure_rate_pct": round(100 * len(failed) / len(prod), 2) if prod else None,
            "successful_deployments": len(successful),
            "failed_deployments": len(failed),
            "production_deployments_total": len(prod),
            "incident_issues_closed_this_month": len(mttr_hours),
        },
        "deployments": sorted(deploy_rows, key=lambda x: x.get("time") or "", reverse=True)[:30],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(metrics, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(metrics["summary"], indent=2))


if __name__ == "__main__":
    main()
