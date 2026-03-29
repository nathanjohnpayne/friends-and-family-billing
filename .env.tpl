# Firebase web config — resolved by `op inject` during bootstrap.
# Run: op inject -i .env.tpl -o .env.local -f
# Or:  ./scripts/bootstrap.sh
VITE_FIREBASE_API_KEY={{ op://Private/mlhbupjcaad7on734553e252pi/Firebase/api_key }}
VITE_FIREBASE_AUTH_DOMAIN={{ op://Private/mlhbupjcaad7on734553e252pi/Firebase/auth_domain }}
VITE_FIREBASE_PROJECT_ID={{ op://Private/mlhbupjcaad7on734553e252pi/Firebase/project_id }}
VITE_FIREBASE_STORAGE_BUCKET={{ op://Private/mlhbupjcaad7on734553e252pi/Firebase/storage_bucket }}
VITE_FIREBASE_MESSAGING_SENDER_ID={{ op://Private/mlhbupjcaad7on734553e252pi/Firebase/messaging_sender_id }}
VITE_FIREBASE_APP_ID={{ op://Private/mlhbupjcaad7on734553e252pi/Firebase/app_id }}
VITE_FIREBASE_MEASUREMENT_ID={{ op://Private/mlhbupjcaad7on734553e252pi/Firebase/measurement_id }}
VITE_LOGODEV_KEY={{ op://Private/rtvfyomcqjigt6ezaycht3vy6i/publishable API key }}
