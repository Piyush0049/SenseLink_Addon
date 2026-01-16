# FaceControl – AI‑Powered Mouse Control for Users with Disabilities

A cutting‑edge add‑on for **Adobe Express** that enables users with limited mobility to control the mouse cursor using facial movements captured via the webcam. Leveraging real‑time face‑tracking AI, the tool translates subtle head gestures and facial expressions into precise cursor actions, providing an inclusive design experience. This project uses a companion local backend to perform system-level mouse actions.

## ✨ Features

- **Head‑Tilt Navigation** – Move the cursor left, right, up, and down by tilting the head.
- **Mouth‑Open Click** – Open mouth to perform a left‑click; a quick double‑open triggers a double‑click.
- **Eye‑Blink Scroll** – Blink once to scroll down, twice to scroll up.
- **Adjustable Sensitivity** – Users can fine‑tune movement speed and click thresholds.
- **Visual Feedback Overlay** – On‑screen indicator shows current gesture and cursor position.
- **Dark/Light Theme** – Seamless integration with Adobe Express UI themes.
- **Privacy‑First** – All facial processing runs locally; no video data is sent to external servers.

## 📁 Project Structure

```
facecontrol/
├── src/                    # Frontend UI & face‑tracking logic
│   ├── index.html         # Main UI
│   ├── index.js           # Core JavaScript (Webcam, TensorFlow.js, gesture mapping)
│   ├── styles.css         # Premium glassmorphism design
│   └── manifest.json      # Add‑on configuration
│
├── facecontrol-backend/   # Local Node.js server for system mouse control
│   ├── server.js          # Express server with mouse control API
│   ├── MouseMover.cs      # C# Native mouse interaction logic
│   └── package.json
│
└── dist/                  # Built add‑on files
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Modern browser with webcam support (Chrome/Edge recommended)
- Adobe Express account
- Windows OS (for backend mouse control features)

### Installation

1. **Clone the repository** (or copy the folder into your workspace):
   ```bash
   cd d:\adobe_addons\assistance_app
   ```

2. **Install Frontend Dependencies**:
   ```bash
   npm install
   ```

3. **Install Backend Dependencies**:
   ```bash
   cd facecontrol-backend
   npm install
   cd ..
   ```

### Running the Add‑On

1. **Start the Backend Server**:
   ```bash
   cd facecontrol-backend
   npm start
   ```
   *Keep this terminal running.*

2. **Start the Development Server (Frontend)**:
   In a new terminal:
   ```bash
   npm run start
   ```

3. **Launch in Adobe Express**:
   1. Open **Adobe Express** (new.express.adobe.com).
   2. Enable **Developer Mode** in settings.
   3. Load the add‑on from `https://localhost:5241`.
   4. Grant webcam permission when prompted.
   5. Use the on‑screen control panel to calibrate gestures.

## 📊 Accessibility Impact

- **Empowers** users with motor impairments to interact with Adobe Express without a physical mouse.
- **Reduces** reliance on external assistive hardware.
- **Complies** with WCAG 2.1 AA guidelines for keyboard‑less navigation.

## 🛠️ Development

### Build for Production

```bash
npm run build   # Generates optimized assets in the dist/ folder
```

### Package for Distribution

```bash
npm run package   # Creates a zip ready for Adobe Add‑On submission
```

## 📝 License

This project is provided for educational and accessibility‑focused purposes. Please consult legal counsel for any commercial deployment.

## 🤝 Contributing

Contributions are welcome! Feel free to submit issues, pull requests, or suggestions to improve gesture accuracy and UI polish.

---

**Built with ❤️ for inclusive design**
