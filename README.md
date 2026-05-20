# SGPA & CGPA Calculator PWA

A modern Progressive Web App for B.Tech students to calculate semester SGPA and overall CGPA with beautiful responsive design, dark mode, offline support, and local storage persistence.

## Features

- Add and manage multiple semesters
- Editable subject names, credits, and grades from S to F
- Real-time SGPA calculation per semester
- Accurate CGPA calculation with weighted semester credits
- Responsive mobile, tablet, and desktop layout
- Dark/light theme toggle
- Progressive Web App install support and offline caching
- Semester performance chart and academic summary
- Save state automatically to local storage
- Print report / save as PDF

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Start the local server:

```bash
npm start
```

3. Open the app in your browser at:

```bash
http://localhost:8080
```

## PWA support

- Open the app in Chrome/Edge and install it from the browser install prompt.
- The app works offline after the first load.

## Files

- `index.html` — main calculator UI
- `styles.css` — modern glassmorphism theme and responsive layout
- `script.js` — app logic, semester management, chart rendering, and PWA features
- `manifest.json` — Progressive Web App configuration
- `sw.js` — service worker for offline caching
- `server.js` — local web server for development
- `offline.html` — offline fallback page
- `icons/` — PWA icon artwork
