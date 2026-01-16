# FaceControl Mouse Backend

Controls the system mouse based on commands from the FaceControl Adobe Add-On.

## Installation

```bash
cd facecontrol-backend
npm install
```

**Note**: On Windows, you may need to install additional dependencies:
```bash
npm install --global windows-build-tools
```

## Running

```bash
npm start
# or for development
npm run dev
```

## API

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/api/health` | GET | - | Health check |
| `/api/mouse` | POST | `{action, x, y, button}` | Mouse control |
| `/api/mouse/position` | GET | - | Get current position |
| `/api/screen` | GET | - | Get screen dimensions |

### Actions

- `move` - Move cursor by delta (x, y)
- `moveTo` - Move cursor to absolute position
- `click` - Click (button: "left" or "right")
- `doubleclick` - Double click
- `scroll` - Scroll (y: positive=up, negative=down)
