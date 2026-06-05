const fs = require('fs');

// Load env variables from .env file if running locally
if (fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const [key, ...valueParts] = trimmed.split('=');
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  });
}

const token = process.env.PRIMARY_TOKEN;
const username = process.env.PRIMARY_USER || 'Felix-au';

if (!token) {
  console.error("❌ PRIMARY_TOKEN environment variable is missing.");
  process.exit(1);
}

const query = `
query {
  viewer {
    name
    login
    followers {
      totalCount
    }
    pullRequests {
      totalCount
    }
    issues {
      totalCount
    }
    repositoriesContributedTo(contributionTypes: [COMMIT, PULL_REQUEST, PULL_REQUEST_REVIEW, ISSUE]) {
      totalCount
    }
    repositories(first: 100, ownerAffiliations: OWNER) {
      nodes {
        name
        isPrivate
        stargazerCount
        forkCount
        watchers {
          totalCount
        }
        defaultBranchRef {
          target {
            ... on Commit {
              history {
                totalCount
              }
            }
          }
        }
        releases(first: 20) {
          totalCount
          nodes {
            releaseAssets(first: 20) {
              nodes {
                downloadCount
              }
            }
          }
        }
        languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
          edges {
            size
            node {
              name
              color
            }
          }
        }
      }
    }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      totalPullRequestReviewContributions
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            contributionCount
            date
          }
        }
      }
    }
  }
}
`;

async function main() {
  console.log(`📡 Fetching stats from GitHub GraphQL API for ${username}...`);
  
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'Node-GitHub-Custom-Widgets-Generator',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });
  
  const json = await res.json();
  if (!res.ok || json.errors) {
    console.error("❌ GraphQL Query failed:", JSON.stringify(json.errors || json));
    process.exit(1);
  }
  
  const viewer = json.data.viewer;
  const name = viewer.name || viewer.login;
  const repos = viewer.repositories.nodes;
  
  // 1. Gather stats
  const stars = repos.reduce((acc, curr) => acc + curr.stargazerCount, 0);
  const forks = repos.reduce((acc, curr) => acc + curr.forkCount, 0);
  const watchers = repos.reduce((acc, curr) => acc + curr.watchers.totalCount, 0);
  const commitsThisYear = viewer.contributionsCollection.totalCommitContributions;
  const publicReposCount = repos.filter(repo => !repo.isPrivate).length;
  
  let commitsOverall = 0;
  repos.forEach(repo => {
    if (repo.defaultBranchRef && repo.defaultBranchRef.target && repo.defaultBranchRef.target.history) {
      commitsOverall += repo.defaultBranchRef.target.history.totalCount;
    }
  });
  
  let totalReleases = 0;
  let totalDownloads = 0;
  repos.forEach(repo => {
    if (repo.releases) {
      totalReleases += repo.releases.totalCount || 0;
      if (repo.releases.nodes) {
        repo.releases.nodes.forEach(rel => {
          if (rel.releaseAssets && rel.releaseAssets.nodes) {
            rel.releaseAssets.nodes.forEach(asset => {
              totalDownloads += asset.downloadCount || 0;
            });
          }
        });
      }
    }
  });
  
  const prs = viewer.pullRequests.totalCount;
  const issues = viewer.issues.totalCount;
  const reviews = viewer.contributionsCollection.totalPullRequestReviewContributions;
  const contributedTo = viewer.repositoriesContributedTo.totalCount;
  
  // 2. Grade calculation
  const score = stars * 4 + commitsOverall * 0.1 + prs * 2 + issues * 1 + reviews * 2;
  let grade = 'B';
  if (score >= 1000) grade = 'S';
  else if (score >= 500) grade = 'A+';
  else if (score >= 200) grade = 'A';
  else if (score >= 100) grade = 'B+';
  
  const circlePercent = Math.min(100, (score / 1500) * 100);
  const strokeDashoffset = Math.max(0, 283 - (283 * circlePercent) / 100);
  
  // 3. Process Languages (Ignore Jupyter Notebook)
  const langMap = new Map();
  let totalLangSize = 0;
  
  repos.forEach(repo => {
    if (repo.languages && repo.languages.edges) {
      repo.languages.edges.forEach(edge => {
        const langName = edge.node.name;
        const color = edge.node.color;
        const size = edge.size;
        
        // Skip Jupyter Notebook as requested
        if (langName.toLowerCase() === 'jupyter notebook') return;
        
        if (langMap.has(langName)) {
          const item = langMap.get(langName);
          item.size += size;
        } else {
          langMap.set(langName, { name: langName, color, size });
        }
        totalLangSize += size;
      });
    }
  });
  
  const sortedLangs = Array.from(langMap.values()).sort((a, b) => b.size - a.size);
  const topLangs = sortedLangs.slice(0, 6);
  
  // 4. Calculate contribution streaks
  const calendar = viewer.contributionsCollection.contributionCalendar;
  const days = [];
  calendar.weeks.forEach(w => {
    w.contributionDays.forEach(d => {
      days.push(d);
    });
  });
  
  days.sort((a, b) => a.date.localeCompare(b.date));
  
  let longestStreak = 0;
  let longestStart = '';
  let longestEnd = '';
  
  let tempStreak = 0;
  let tempStart = '';
  
  for (let i = 0; i < days.length; i++) {
    const count = days[i].contributionCount;
    const date = days[i].date;
    
    if (count > 0) {
      if (tempStreak === 0) {
        tempStart = date;
      }
      tempStreak++;
      if (tempStreak > longestStreak) {
        longestStreak = tempStreak;
        longestStart = tempStart;
        longestEnd = date;
      }
    } else {
      tempStreak = 0;
    }
  }
  
  // Find current streak ending either today or yesterday in Indian timezone (+05:30)
  const istDate = new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000));
  const istTodayStr = istDate.toISOString().split('T')[0];
  const yesterdayDate = new Date(istDate.getTime() - (24 * 60 * 60 * 1000));
  const istYesterdayStr = yesterdayDate.toISOString().split('T')[0];
  
  let todayIdx = days.findIndex(d => d.date === istTodayStr);
  if (todayIdx === -1) todayIdx = days.length - 1;
  
  let currentStreakActive = false;
  let startScanIdx = todayIdx;
  let currentEnd = '';
  
  if (days[todayIdx] && days[todayIdx].contributionCount > 0) {
    currentStreakActive = true;
    currentEnd = days[todayIdx].date;
  } else {
    const yestIdx = days.findIndex(d => d.date === istYesterdayStr);
    if (yestIdx !== -1 && days[yestIdx].contributionCount > 0) {
      currentStreakActive = true;
      currentEnd = days[yestIdx].date;
      startScanIdx = yestIdx;
    }
  }
  
  let currentStreak = 0;
  let currentStart = '';
  
  if (currentStreakActive) {
    let tempCurr = 0;
    for (let i = startScanIdx; i >= 0; i--) {
      if (days[i].contributionCount > 0) {
        tempCurr++;
        currentStart = days[i].date;
      } else {
        break;
      }
    }
    currentStreak = tempCurr;
  }
  
  function formatDateRange(startStr, endStr) {
    if (!startStr || !endStr) return 'No active streak';
    const options = { month: 'short', day: 'numeric' };
    const start = new Date(startStr).toLocaleDateString('en-US', options);
    const end = new Date(endStr).toLocaleDateString('en-US', options);
    return `${start} - ${end}`;
  }
  
  const currentStreakRange = formatDateRange(currentStart, currentEnd);
  const longestStreakRange = formatDateRange(longestStart, longestEnd);
  const totalContributionsPastYear = calendar.totalContributions;
  
  // 5. Render SVGs
  console.log(`🎨 Rendering Custom Unified SVG widget...`);
  
  // Process top languages bar rects and grid items
  let currentX = 0;
  let progressBarRects = '';
  topLangs.forEach(lang => {
    const width = totalLangSize > 0 ? (lang.size / totalLangSize) * 550 : 0;
    progressBarRects += `<rect x="${currentX.toFixed(1)}" width="${width.toFixed(1)}" height="12" fill="${lang.color || '#cccccc'}" />\n`;
    currentX += width;
  });

  let langGridList = '';
  topLangs.forEach((lang, index) => {
    const percent = totalLangSize > 0 ? ((lang.size / totalLangSize) * 100).toFixed(2) : '0.00';
    const row = Math.floor(index / 3);
    const col = index % 3;
    const colX = col * 175;
    const rowY = row * 22;
    
    langGridList += `
    <g transform="translate(${colX}, ${rowY})">
      <circle cx="5" cy="6" r="5" fill="${lang.color || '#cccccc'}" />
      <text x="18" y="10" class="lang-name">${lang.name} <tspan class="lang-percent">${percent}%</tspan></text>
    </g>`;
  });

  const statsSvg = `
<svg width="600" height="400" viewBox="0 0 600 400" fill="none" xmlns="http://www.w3.org/2000/svg">
  <style>
    .title { font: bold 16px 'Segoe UI', Ubuntu, sans-serif; fill: #88c0d0; }
    .label { font: 13px 'Segoe UI', Ubuntu, sans-serif; fill: #d8dee9; }
    .value { font: bold 13px 'Segoe UI', Ubuntu, sans-serif; fill: #e5e9f0; }
    .range { font: 10px 'Segoe UI', Ubuntu, sans-serif; fill: #e5e9f0; opacity: 0.8; }
    
    .streak-title { font: bold 14px 'Segoe UI', Ubuntu, sans-serif; fill: #d8dee9; }
    .streak-val { font: bold 14px 'Segoe UI', Ubuntu, sans-serif; fill: #88c0d0; }
    .streak-range { font: 11px 'Segoe UI', Ubuntu, sans-serif; fill: #e5e9f0; opacity: 0.85; }
    
    .grade-text { font: bold 32px 'Segoe UI', Ubuntu, sans-serif; fill: #88c0d0; text-anchor: middle; dominant-baseline: middle; }
    .grade-circle { stroke: #88c0d0; stroke-width: 6; fill: none; }
    .grade-circle-bg { stroke: #3b4252; stroke-width: 6; fill: none; }
    
    .icon { fill: #81a1c1; }
    .divider { stroke: #3b4252; stroke-width: 1; }
    
    .lang-title { font: bold 15px 'Segoe UI', Ubuntu, sans-serif; fill: #88c0d0; }
    .lang-name { font: bold 12px 'Segoe UI', Ubuntu, sans-serif; fill: #d8dee9; }
    .lang-percent { font: 12px 'Segoe UI', Ubuntu, sans-serif; fill: #e5e9f0; }
  </style>
  <rect width="598" height="398" x="1" y="1" rx="6" fill="#2e3440" stroke="#3b4252" stroke-width="2"/>
  
  <!-- Centered Title -->
  <text x="300" y="35" class="title" text-anchor="middle">${name}'s GitHub Stats</text>
  
  <!-- COLUMN 1 -->
  <g transform="translate(25, 55)">
    <!-- Commits this year -->
    <svg x="0" y="5" width="14" height="14" viewBox="0 0 16 16" class="icon"><path d="M10.5 7.75a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm1.5 0a4 4 0 1 0-8 0 4 4 0 0 0 8 0ZM8 0a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 0ZM8 13a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 13ZM3 8a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 3 8Zm11.5.75a.75.75 0 0 0 0-1.5h-1.5a.75.75 0 0 0 0 1.5h1.5Z"/></svg>
    <text x="22" y="17" class="label">Commits (this year):</text>
    <text x="205" y="17" class="value" text-anchor="end">${commitsThisYear}</text>
    
    <!-- Total Contributions -->
    <svg x="0" y="28" width="14" height="14" viewBox="0 0 16 16" class="icon"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/></svg>
    <text x="22" y="40" class="label">Total Contributions:</text>
    <text x="205" y="40" class="value" text-anchor="end">${totalContributionsPastYear}</text>
    
    <!-- Contributed to -->
    <svg x="0" y="51" width="14" height="14" viewBox="0 0 16 16" class="icon"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 1 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 0 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5v-9Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8v-7.5Z"/></svg>
    <text x="22" y="63" class="label">Contributed to:</text>
    <text x="205" y="63" class="value" text-anchor="end">${contributedTo}</text>
    
    <!-- Repos (Public) -->
    <svg x="0" y="74" width="14" height="14" viewBox="0 0 16 16" class="icon"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 1 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 0 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5v-9Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8v-7.5Z"/></svg>
    <text x="22" y="86" class="label">Repos (Public):</text>
    <text x="205" y="86" class="value" text-anchor="end">${publicReposCount}</text>
    
    <!-- Releases -->
    <svg x="0" y="97" width="14" height="14" viewBox="0 0 16 16" class="icon"><path d="M2.5 0A2.5 2.5 0 0 0 0 2.5v11A2.5 2.5 0 0 0 2.5 16h11a2.5 2.5 0 0 0 2.5-2.5v-11A2.5 2.5 0 0 0 13.5 0h-11Zm0 1.5h11a1 1 0 0 1 1 1v6.75l-4-4-3 3-2-2-3 3v-7.75a1 1 0 0 1 1-1Z"/></svg>
    <text x="22" y="109" class="label">Releases:</text>
    <text x="205" y="109" class="value" text-anchor="end">${totalReleases}</text>
    
    <!-- Downloads -->
    <svg x="0" y="120" width="14" height="14" viewBox="0 0 16 16" class="icon"><path d="M2.75 14A.75.75 0 0 1 3.5 13.25h9a.75.75 0 0 1 0 1.5h-9A.75.75 0 0 1 2.75 14Zm5.25-10.25V9.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06L7 9.19V3.75a.75.75 0 0 1 1.5 0Z"/></svg>
    <text x="22" y="132" class="label">Downloads:</text>
    <text x="205" y="132" class="value" text-anchor="end">${totalDownloads}</text>
  </g>
  
  <!-- COLUMN 2 (Rank Badge - Shifted right for spacing) -->
  <g transform="translate(315, 120)">
    <circle cx="0" cy="0" r="45" class="grade-circle-bg" />
    <circle cx="0" cy="0" r="45" class="grade-circle" stroke-dasharray="283" stroke-dashoffset="${strokeDashoffset.toFixed(1)}" transform="rotate(-90)" />
    <text x="0" y="0" class="grade-text">${grade}</text>
  </g>
  
  <!-- COLUMN 3 (Shifted right) -->
  <g transform="translate(400, 55)">
    <!-- Total Stars -->
    <svg x="0" y="5" width="14" height="14" viewBox="0 0 16 16" class="icon"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"/></svg>
    <text x="22" y="17" class="label">Total Stars:</text>
    <text x="175" y="17" class="value" text-anchor="end">${stars}</text>
    
    <!-- Total Watchers -->
    <svg x="0" y="28" width="14" height="14" viewBox="0 0 16 16" class="icon"><path d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.267 2.445 2.872 3.593a.75.75 0 0 1-.001.658c-.605 1.147-1.602 2.502-2.872 3.593C11.671 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83 .8 9.476.196 8.329a.75.75 0 0 1 .001-.658c.605-1.147 1.602-2.502 2.872-3.593C4.329 2.992 6.019 2 8 2ZM2.052 8c.552 1.01 1.436 2.222 2.548 3.18C5.7 12.138 7.006 12.5 8 12.5c.994 0 2.3-.362 3.4-1.32 1.112-.958 1.996-2.17 2.548-3.18-.552-1.01-1.436-2.222-2.548-3.18C10.3 3.862 8.994 3.5 8 3.5c-.994 0-2.3.362-3.4 1.32-1.112.958-1.996 2.17-2.548 3.18ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z"/></svg>
    <text x="22" y="40" class="label">Total Watchers:</text>
    <text x="175" y="40" class="value" text-anchor="end">${watchers}</text>
    
    <!-- Total Forks -->
    <svg x="0" y="51" width="14" height="14" viewBox="0 0 16 16" class="icon"><path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h4.5A2.25 2.25 0 0 0 12.5 6.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878Zm7.5-2.122a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM4.25 12a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 1.5a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5Z"/></svg>
    <text x="22" y="63" class="label">Total Forks:</text>
    <text x="175" y="63" class="value" text-anchor="end">${forks}</text>
    
    <!-- Pull Requests -->
    <svg x="0" y="74" width="14" height="14" viewBox="0 0 16 16" class="icon"><path d="M7.177 3.073L9.573.677A.25.25 0 0 1 10 .854v4.292a.25.25 0 0 1-.427.177L7.177 3.073ZM5.75 2h-1.5a2.25 2.25 0 0 0-2.25 2.25v7.5a2.25 2.25 0 0 0 2.25 2.25h7.5a2.25 2.25 0 0 0 2.25-2.25v-1.5a.75.75 0 0 1 1.5 0v1.5a3.75 3.75 0 0 1-3.75 3.75h-7.5A3.75 3.75 0 0 1 .5 11.75v-7.5A3.75 3.75 0 0 1 4.25.5h1.5a.75.75 0 0 1 0 1.5Zm6.48 4.28a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-2-2a.75.75 0 0 1 1.06-1.06l1.47 1.47 3.97-3.97a.75.75 0 0 1 1.06 0Z"/></svg>
    <text x="22" y="86" class="label">Pull Requests:</text>
    <text x="175" y="86" class="value" text-anchor="end">${prs}</text>
    
    <!-- Code Reviews -->
    <svg x="0" y="97" width="14" height="14" viewBox="0 0 16 16" class="icon"><path d="M1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25v-8.5C0 2.784.784 2 1.75 2Zm0 1.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25H1.75ZM5 5.75A.75.75 0 0 1 5.75 5h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 5.75ZM5.75 8h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5Z"/></svg>
    <text x="22" y="109" class="label">Code Reviews:</text>
    <text x="175" y="109" class="value" text-anchor="end">${reviews}</text>
    
    <!-- Issues -->
    <svg x="0" y="120" width="14" height="14" viewBox="0 0 16 16" class="icon"><path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/></svg>
    <text x="22" y="132" class="label">Issues:</text>
    <text x="175" y="132" class="value" text-anchor="end">${issues}</text>
  </g>
  
  <!-- Divider -->
  <line x1="25" y1="205" x2="575" y2="205" class="divider" />
  
  <!-- ROW 2: Centered Streak Section -->
  <g transform="translate(0, 205)">
    <!-- Current Streak -->
    <text x="160" y="25" class="streak-title" text-anchor="middle">🔥 Current Streak: <tspan class="streak-val">${currentStreak} Days</tspan> <tspan class="streak-range">(${currentStreakRange})</tspan></text>
    
    <!-- Vertical Divider -->
    <line x1="300" y1="10" x2="300" y2="30" class="divider" />
    
    <!-- Longest Streak -->
    <text x="440" y="25" class="streak-title" text-anchor="middle">🏆 Longest Streak: <tspan class="streak-val">${longestStreak} Days</tspan> <tspan class="streak-range">(${longestStreakRange})</tspan></text>
  </g>
  
  <!-- Divider -->
  <line x1="25" y1="245" x2="575" y2="245" class="divider" />
  
  <!-- ROW 3: Centered Most Used Languages -->
  <g transform="translate(25, 255)">
    <!-- Centered Language Header -->
    <text x="275" y="20" class="lang-title" text-anchor="middle">Most Used Languages</text>
    
    <svg x="0" y="30" width="550" height="12">
      <rect width="550" height="12" rx="6" fill="#3b4252"/>
      <clipPath id="bar-clip">
        <rect width="550" height="12" rx="6" />
      </clipPath>
      <g clip-path="url(#bar-clip)">
        ${progressBarRects}
      </g>
    </svg>
    
    <!-- Centered Language Grid Legend -->
    <g transform="translate(50, 55)">
      ${langGridList}
    </g>
  </g>
</svg>
  `;

  fs.writeFileSync('github-stats.svg', statsSvg.trim());
  console.log(`✅ custom widgets generated successfully!`);
}

main().catch(err => {
  console.error("❌ Widget generation failed:", err);
  process.exit(1);
});
