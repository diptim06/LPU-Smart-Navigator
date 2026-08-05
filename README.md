# LPU Smart Navigator

Project structure for LPU Smart Navigator.

## Project Structure

```
LPU-Smart-Navigator/
├── frontend/     # React + Vite + TypeScript + Tailwind CSS
├── backend/      # C++20 CMake Backend
├── data/         # Data folder
├── README.md
└── .gitignore
```

## Running the Projects

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Backend
```bash
cd backend
cmake -B build
cmake --build build
./build/lpu_smart_navigator_backend
```
