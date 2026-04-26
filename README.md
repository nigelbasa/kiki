# Rwendo — Smart Traffic Control System

Web-based smart traffic signal control prototype for a three-intersection L-shaped network in Harare. Built as a University of Zimbabwe AI & ML capstone. Two separate React portals (admin and public) share one FastAPI + Socket.IO backend, with a SUMO-backed simulation engine.

## Installation & Setup

To set up this project on a new machine, you need to install the following core dependencies:

### 1. Install SUMO
The backend simulation physics rely on Eclipse SUMO (Simulation of Urban MObility).
- Download and install SUMO from the [official website](https://eclipse.dev/sumo/).
- **Important**: Ensure the `SUMO_HOME` environment variable is configured and `sumo` is available in your system `PATH` during installation.

### 2. Install Node.js
The frontend React portals require Node.js.
- Download and install Node.js (v18 or higher) from [nodejs.org](https://nodejs.org/).

### 3. Install Python & Backend Dependencies
The backend requires Python 3.11+. We recommend using a virtual environment.
```bash
cd backend
python -m venv venv

# Activate the virtual environment:
# Windows:
venv\Scripts\activate
# macOS/Linux:
# source venv/bin/activate

pip install -r requirements.txt
```

### 4. Install Frontend Dependencies
```bash
cd frontend
npm install
```

## Running the Application

You need to run the backend and the frontend portals in separate terminal windows.

### Start the Backend
```bash
cd backend
# Ensure your virtual environment is activated
uvicorn main:app --reload --port 8000
```

### Start the Admin Portal
```bash
cd frontend
npm run dev:admin
# The portal will be available at http://localhost:5173
```

### Start the Public Portal
```bash
cd frontend
npm run dev:public
# The portal will be available at http://localhost:5174
```

## Default Credentials

When accessing the system, use the following default credentials to log in:

| Portal | Username | Password              |
|--------|----------|-----------------------|
| Admin  | admin    | rwendo-admin-2025     |
| Public | public   | rwendo-public-2025    |
