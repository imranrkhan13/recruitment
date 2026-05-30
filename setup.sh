#!/bin/bash

# Aria AI Recruiter - Quick Start Script
# Run this to set up and start the application

echo "🚀 Aria AI Recruiter - Setup Starting..."
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not installed. Please install Node.js 16+"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install --legacy-peer-deps

# Create .env.local if it doesn't exist
if [ ! -f .env.local ]; then
    echo ""
    echo "⚠️  .env.local not found. Creating from template..."
    cp .env.example .env.local
    echo "✅ Created .env.local - Please update with your Bolna API key"
fi

# Build frontend
echo ""
echo "🔨 Building frontend..."
npm run build

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start the application:"
echo "  npm start              (runs both backend and frontend)"
echo ""
echo "Or run separately:"
echo "  Terminal 1: npm run server  (backend on :3001)"
echo "  Terminal 2: npm run dev     (frontend on :5173)"
echo ""
echo "Then open: http://localhost:5173"
