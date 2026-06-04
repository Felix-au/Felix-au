const fs = require('fs');

// Load token and username from environment
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
  
  let commitsOverall = 0;
  repos.forEach(repo => {
    if (repo.defaultBranchRef && repo.defaultBranchRef.target && repo.defaultBranchRef.target.history) {
      commitsOverall += repo.defaultBranchRef.target.history.totalCount;
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
    const options = { month: 'short', day: 'numeric', year: 'numeric' };
    const start = new Date(startStr).toLocaleDateString('en-US', options);
    const end = new Date(endStr).toLocaleDateString('en-US', options);
    return `${start} - ${end}`;
  }
  
  const currentStreakRange = formatDateRange(currentStart, currentEnd);
  const longestStreakRange = formatDateRange(longestStart, longestEnd);
  const totalContributionsPastYear = calendar.totalContributions;
  
  // 5. Render SVGs
  console.log(`🎨 Rendering Custom SVG widgets...`);
  
  // SVG 1: github-stats.svg (Stats Dashboard)
  const statsSvg = `
<svg width="495" height="280" viewBox="0 0 495 280" fill="none" xmlns="http://www.w3.org/2000/svg">
  <style>
    .title { font: bold 18px 'Segoe UI', Ubuntu, sans-serif; fill: #88c0d0; }
    .label { font: 14px 'Segoe UI', Ubuntu, sans-serif; fill: #d8dee9; }
    .value { font: bold 14px 'Segoe UI', Ubuntu, sans-serif; fill: #e5e9f0; }
    .grade-text { font: bold 32px 'Segoe UI', Ubuntu, sans-serif; fill: #88c0d0; text-anchor: middle; dominant-baseline: middle; }
    .grade-circle { stroke: #88c0d0; stroke-width: 6; fill: none; }
    .grade-circle-bg { stroke: #3b4252; stroke-width: 6; fill: none; }
    .icon { fill: #81a1c1; }
  </style>
  <rect width="493" height="278" x="1" y="1" rx="5" fill="#2e3440" stroke="#3b4252" stroke-width="2"/>
  
  <text x="25" y="35" class="title">${name}'s GitHub Stats</text>
  
  <g transform="translate(25, 60)">
    <!-- Stars -->
    <svg x="0" y="0" width="16" height="16" viewBox="0 0 16 16" class="icon"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"/></svg>
    <text x="25" y="13" class="label">Total Stars:</text>
    <text x="220" y="13" class="value">${stars}</text>
    
    <!-- Watchers -->
    <svg x="0" y="22" width="16" height="16" viewBox="0 0 16 16" class="icon"><path d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.267 2.445 2.872 3.593a.75.75 0 0 1-.001.658c-.605 1.147-1.602 2.502-2.872 3.593C11.671 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83 .8 9.476.196 8.329a.75.75 0 0 1 .001-.658c.605-1.147 1.602-2.502 2.872-3.593C4.329 2.992 6.019 2 8 2ZM2.052 8c.552 1.01 1.436 2.222 2.548 3.18C5.7 12.138 7.006 12.5 8 12.5c.994 0 2.3-.362 3.4-1.32 1.112-.958 1.996-2.17 2.548-3.18-.552-1.01-1.436-2.222-2.548-3.18C10.3 3.862 8.994 3.5 8 3.5c-.994 0-2.3.362-3.4 1.32-1.112.958-1.996 2.17-2.548 3.18ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z"/></svg>
    <text x="25" y="35" class="label">Total Watchers:</text>
    <text x="220" y="35" class="value">${watchers}</text>
    
    <!-- Forks -->
    <svg x="0" y="44" width="16" height="16" viewBox="0 0 16 16" class="icon"><path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h4.5A2.25 2.25 0 0 0 12.5 6.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878Zm7.5-2.122a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM4.25 12a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 1.5a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5Z"/></svg>
    <text x="25" y="57" class="label">Total Forks:</text>
    <text x="220" y="57" class="value">${forks}</text>
    
    <!-- Commits this year -->
    <svg x="0" y="66" width="16" height="16" viewBox="0 0 16 16" class="icon"><path d="M10.5 7.75a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm1.5 0a4 4 0 1 0-8 0 4 4 0 0 0 8 0ZM8 0a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 0ZM8 13a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 13ZM3 8a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 3 8Zm11.5.75a.75.75 0 0 0 0-1.5h-1.5a.75.75 0 0 0 0 1.5h1.5Z"/></svg>
    <text x="25" y="79" class="label">Commits (this year):</text>
    <text x="220" y="79" class="value">${commitsThisYear}</text>
    
    <!-- Commits overall -->
    <svg x="0" y="88" width="16" height="16" viewBox="0 0 16 16" class="icon"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 1 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 0 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5v-9Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8v-7.5ZM5 3.75A.75.75 0 0 1 5.75 3h5.5a.75.75 0 0 1 0 1.5h-5.5A.75.75 0 0 1 5 3.75ZM5.75 6h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1 0-1.5ZM4.25 12a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 1.5a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5Z"/></svg>
    <text x="25" y="101" class="label">Commits (overall):</text>
    <text x="220" y="101" class="value">${commitsOverall}</text>
    
    <!-- Pull Requests -->
    <svg x="0" y="110" width="16" height="16" viewBox="0 0 16 16" class="icon"><path d="M7.177 3.073L9.573.677A.25.25 0 0 1 10 .854v4.292a.25.25 0 0 1-.427.177L7.177 3.073ZM5.75 2h-1.5a2.25 2.25 0 0 0-2.25 2.25v7.5a2.25 2.25 0 0 0 2.25 2.25h7.5a2.25 2.25 0 0 0 2.25-2.25v-1.5a.75.75 0 0 1 1.5 0v1.5a3.75 3.75 0 0 1-3.75 3.75h-7.5A3.75 3.75 0 0 1 .5 11.75v-7.5A3.75 3.75 0 0 1 4.25.5h1.5a.75.75 0 0 1 0 1.5Zm6.48 4.28a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-2-2a.75.75 0 0 1 1.06-1.06l1.47 1.47 3.97-3.97a.75.75 0 0 1 1.06 0Z"/></svg>
    <text x="25" y="123" class="label">Pull Requests:</text>
    <text x="220" y="123" class="value">${prs}</text>
    
    <!-- Code Reviews -->
    <svg x="0" y="132" width="16" height="16" viewBox="0 0 16 16" class="icon"><path d="M1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25v-8.5C0 2.784.784 2 1.75 2Zm0 1.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25H1.75ZM5 5.75A.75.75 0 0 1 5.75 5h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 5.75ZM5.75 8h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5Z"/></svg>
    <text x="25" y="145" class="label">Code Reviews:</text>
    <text x="220" y="145" class="value">${reviews}</text>
    
    <!-- Issues -->
    <svg x="0" y="154" width="16" height="16" viewBox="0 0 16 16" class="icon"><path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/></svg>
    <text x="25" y="167" class="label">Issues:</text>
    <text x="220" y="167" class="value">${issues}</text>
    
    <!-- Contributed to -->
    <svg x="0" y="176" width="16" height="16" viewBox="0 0 16 16" class="icon"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 1 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 0 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5v-9Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8v-7.5Z"/></svg>
    <text x="25" y="189" class="label">Contributed to:</text>
    <text x="220" y="189" class="value">${contributedTo}</text>
  </g>
  
  <g transform="translate(390, 155)">
    <circle cx="0" cy="0" r="45" class="grade-circle-bg" />
    <circle cx="0" cy="0" r="45" class="grade-circle" stroke-dasharray="283" stroke-dashoffset="${strokeDashoffset.toFixed(1)}" transform="rotate(-90)" />
    <text x="0" y="0" class="grade-text">${grade}</text>
  </g>
</svg>
  `;

  // Process top languages bar rects and grid items
  let currentX = 0;
  let progressBarRects = '';
  topLangs.forEach(lang => {
    const width = totalLangSize > 0 ? (lang.size / totalLangSize) * 300 : 0;
    progressBarRects += `<rect x="${currentX.toFixed(1)}" width="${width.toFixed(1)}" height="12" fill="${lang.color || '#cccccc'}" />\n`;
    currentX += width;
  });

  let langGridList = '';
  topLangs.forEach((lang, index) => {
    const percent = totalLangSize > 0 ? ((lang.size / totalLangSize) * 100).toFixed(2) : '0.00';
    const row = Math.floor(index / 2);
    const col = index % 2;
    const colX = col * 160;
    const rowY = row * 25;
    
    langGridList += `
    <g transform="translate(${colX}, ${rowY})">
      <circle cx="5" cy="6" r="5" fill="${lang.color || '#cccccc'}" />
      <text x="18" y="10" class="lang-name">${lang.name} <tspan class="lang-percent">${percent}%</tspan></text>
    </g>`;
  });

  // SVG 2: github-top-langs.svg
  const langsSvg = `
<svg width="350" height="280" viewBox="0 0 350 280" fill="none" xmlns="http://www.w3.org/2000/svg">
  <style>
    .title { font: bold 18px 'Segoe UI', Ubuntu, sans-serif; fill: #88c0d0; }
    .lang-name { font: bold 12px 'Segoe UI', Ubuntu, sans-serif; fill: #d8dee9; }
    .lang-percent { font: 12px 'Segoe UI', Ubuntu, sans-serif; fill: #e5e9f0; }
  </style>
  <rect width="348" height="278" x="1" y="1" rx="5" fill="#2e3440" stroke="#3b4252" stroke-width="2"/>
  <text x="25" y="35" class="title">Most Used Languages</text>
  
  <svg x="25" y="55" width="300" height="12">
    <rect width="300" height="12" rx="6" fill="#3b4252"/>
    <clipPath id="bar-clip">
      <rect width="300" height="12" rx="6" />
    </clipPath>
    <g clip-path="url(#bar-clip)">
      ${progressBarRects}
    </g>
  </svg>
  
  <g transform="translate(25, 90)">
    ${langGridList}
  </g>
</svg>
  `;

  // SVG 3: github-streak.svg (Streak Stats Card)
  const streakSvg = `
<svg width="495" height="195" viewBox="0 0 495 195" fill="none" xmlns="http://www.w3.org/2000/svg">
  <style>
    .streak-title { font: 12px 'Segoe UI', Ubuntu, sans-serif; fill: #d8dee9; text-anchor: middle; }
    .streak-val { font: bold 28px 'Segoe UI', Ubuntu, sans-serif; fill: #88c0d0; text-anchor: middle; }
    .streak-range { font: 11px 'Segoe UI', Ubuntu, sans-serif; fill: #e5e9f0; text-anchor: middle; }
    .divider { stroke: #3b4252; stroke-width: 1; }
  </style>
  <rect width="493" height="193" x="1" y="1" rx="5" fill="#2e3440" stroke="#3b4252" stroke-width="2"/>
  
  <!-- Column 1: Total Contributions -->
  <g transform="translate(82.5, 45)">
    <text class="streak-title" y="20">Total Contributions</text>
    <text class="streak-val" y="55">${totalContributionsPastYear}</text>
    <text class="streak-range" y="75">past year</text>
  </g>
  
  <line x1="165" y1="35" x2="165" y2="160" class="divider" />
  
  <!-- Column 2: Current Streak -->
  <g transform="translate(247.5, 45)">
    <text class="streak-title" y="20">Current Streak</text>
    <text class="streak-val" y="55">${currentStreak} Days</text>
    <text class="streak-range" y="75">${currentStreakRange}</text>
  </g>
  
  <line x1="330" y1="35" x2="330" y2="160" class="divider" />
  
  <!-- Column 3: Longest Streak -->
  <g transform="translate(412.5, 45)">
    <text class="streak-title" y="20">Longest Streak</text>
    <text class="streak-val" y="55">${longestStreak} Days</text>
    <text class="streak-range" y="75">${longestStreakRange}</text>
  </g>
</svg>
  `;

  // Write files out
  fs.writeFileSync('github-stats.svg', statsSvg.trim());
  fs.writeFileSync('github-top-langs.svg', langsSvg.trim());
  fs.writeFileSync('github-streak.svg', streakSvg.trim());
  
  console.log(`✅ custom widgets generated successfully!`);
}

main().catch(err => {
  console.error("❌ Widget generation failed:", err);
  process.exit(1);
});
