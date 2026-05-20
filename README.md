# SGPA & CGPA Calculator PWA

A polished Progressive Web App designed for B.Tech students to manage semester performance, calculate SGPA and CGPA, export academic reports, and stay productive offline.

## 🚀 Features

- Multiple semester management with editable subject names, grades, and credit values
- Real-time SGPA calculation per semester and cumulative CGPA across all semesters
- Selectable grading systems for B.Tech programs, including VTU, Anna University, JNTU, and custom 7-point variation
- Responsive UI optimized for mobile, tablet, and desktop
- Neon-inspired dashboard styling with modern glassmorphism accents
- Performance trend chart to visualize semester SGPA progress
- PWA install support and offline caching via service worker
- Automatic local storage persistence to retain user data between sessions
- Export academic report as PDF for sharing or printing
- Toast notifications for actions like saving, exporting, and system feedback

## 📦 Installation

1. Clone the repository:

```bash
git clone <REPO_URL>
cd "SGPA-CGPA CALCULATOR"
```

2. Install dependencies:

```bash
npm install
```

3. Start the development server:

```bash
npm start
```

4. Open the app in your browser:

```bash
http://localhost:8080
```

## 🖼️ Screenshots

> Replace the image URLs with actual screenshots once available.

- **Dashboard overview:**

  ![Dashboard screenshot](./screenshots/dashboard.png)

- **Semester tracker:**

  ![Semester tracker screenshot](./screenshots/semester-tracker.png)

- **Performance chart:**

  ![Performance chart screenshot](./screenshots/performance-chart.png)

## 🌐 Live Demo

A live demo can be added here once the app is deployed.

- Demo URL: `https://your-domain.com`

## 🛠️ Technologies Used

- HTML5
- CSS3
- JavaScript (ES6+)
- Chart.js for performance visualization
- html2pdf.js for PDF export
- Service Worker API for offline support
- Web App Manifest for PWA installability
- Node.js / Express for local development server

## 📁 Project Structure

- `index.html` — main app user interface
- `styles.css` — visual design, responsive layout, and theme styling
- `script.js` — core app logic, state management, charts, export, and PWA interactions
- `manifest.json` — Progressive Web App metadata
- `sw.js` — service worker caching logic
- `server.js` — local development server entry point
- `offline.html` — fallback offline page
- `icons/` — application icons and assets

## 🔮 Future Improvements

- Add user authentication and cloud backup for semester data
- Support custom-grade presets and university-specific credit systems
- Add semester note-taking and task planning features
- Improve PDF export layout with a dedicated report page and print styles
- Enable dark/light theme persistence and theme presets
- Add multi-language support for broader accessibility

## 📌 Notes

- The app persists data locally using `localStorage`, so data is retained in the same browser/device.
- For full PWA behavior, serve the app over HTTPS or use `localhost` during development.
