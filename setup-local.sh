#!/bin/bash

echo "🚀 Kharch-Baant Local Setup Script"
echo "=================================="
echo ""

# Check if .env.local exists
if [[ ! -f ".env.local" ]]; then
    echo "📝 Creating .env.local file..."
    cat > .env.local << 'EOF'
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here

# Alternative naming (for compatibility)
REACT_APP_SUPABASE_URL=https://your-project-id.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your_anon_key_here

# API Mode (supabase for production, mock for testing)
REACT_APP_API_MODE=supabase

# Gemini AI API Key (optional, for AI features)
GEMINI_API_KEY=your_gemini_api_key_here
EOF
    echo "✅ Created .env.local file"
    echo ""
    echo "⚠️  IMPORTANT: You need to edit .env.local with your actual Supabase credentials!"
    echo "   Get them from: https://supabase.com/dashboard/project/[your-project]/settings/api"
    echo ""
else
    echo "✅ .env.local file already exists"
fi

echo ""
echo "🔧 Next Steps:"
echo "1. Go to https://supabase.com and create a new project"
echo "2. Copy the SQL from supabase-schema.sql and run it in Supabase SQL Editor"
echo "3. Get your Project URL and Anon Key from Settings > API"
echo "4. Update .env.local with your actual credentials"
echo "5. Run: npm run test:smoke (to test connection)"
echo "6. Run: npm run dev (to start the app)"
echo ""
echo "📖 For detailed instructions, see LOCAL_SETUP.md"
echo ""
echo "🌐 Your app is currently running at: http://localhost:3000"
echo "   (But it needs Supabase credentials to work properly)"
