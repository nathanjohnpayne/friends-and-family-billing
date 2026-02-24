# Firebase Deployment Guide

Your Family Bill Splitter app is now configured to use Firebase for authentication and cloud storage! Follow these steps to deploy it.

## Step 1: Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add Project"
3. Enter a project name (e.g., "family-bill-splitter")
4. Disable Google Analytics (optional)
5. Click "Create Project"

## Step 2: Set Up Authentication

1. In your Firebase project, click "Authentication" in the left sidebar
2. Click "Get Started"
3. Click on "Email/Password" under Sign-in method
4. Enable "Email/Password"
5. Click "Save"

## Step 3: Set Up Firestore Database

1. Click "Firestore Database" in the left sidebar
2. Click "Create Database"
3. Start in **Production mode**
4. Choose a location (e.g., us-central)
5. Click "Enable"

### Configure Firestore Security Rules:

1. Click on the "Rules" tab
2. Replace the rules with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only read/write their own data
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

3. Click "Publish"

## Step 4: Get Your Firebase Configuration

1. Click the gear icon (⚙️) next to "Project Overview"
2. Click "Project Settings"
3. Scroll down to "Your apps"
4. Click the web icon `</>`
5. Enter an app nickname (e.g., "Bill Splitter Web")
6. Click "Register app"
7. Copy the `firebaseConfig` object

## Step 5: Update firebase-config.js

Open `firebase-config.js` and replace the placeholder values with your actual Firebase config:

```javascript
const firebaseConfig = {
    apiKey: "AIza...", // From Firebase console
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abc123"
};
```

## Step 6: Deploy to Firebase Hosting

### Install Firebase CLI:

```bash
npm install -g firebase-tools
```

### Login to Firebase:

```bash
firebase login
```

### Initialize Firebase in your project:

```bash
cd "/Users/nathanpayne/Claude Code"
firebase init
```

When prompted:
- Select: **Hosting**
- Use existing project: Select your project
- Public directory: Enter `.` (current directory)
- Configure as single-page app: **No**
- Set up automatic builds: **No**
- Overwrite index.html: **No**

### Deploy:

```bash
firebase deploy
```

Your app will be live at: `https://your-project-id.web.app`

## Step 7: Test Your App

1. Open your deployed URL
2. Create an account with email/password
3. Login and test all features
4. Add family members, bills, etc.
5. Logout and login again to verify data persistence

## Alternative Deployment Options

### Option 1: Netlify (Free)

1. Create account at [netlify.com](https://netlify.com)
2. Drag and drop your project folder
3. Site will be live at `https://random-name.netlify.app`

### Option 2: Vercel (Free)

1. Create account at [vercel.com](https://vercel.com)
2. Import your GitHub repository
3. Deploy automatically

### Option 3: GitHub Pages (Free)

1. Create a GitHub repository
2. Push your code
3. Go to Settings > Pages
4. Select branch and folder
5. Save and wait for deployment

## Costs

- **Firebase Free Tier**:
  - 50,000 reads/day
  - 20,000 writes/day
  - 20,000 deletes/day
  - 1 GB storage
  - Perfect for personal/family use!

- **If you exceed free tier**:
  - Pay-as-you-go pricing starts at ~$0.06 per 100,000 reads
  - For 10 active users: ~$0-5/month
  - For 50 active users: ~$5-25/month

## Security Notes

- Each user can only access their own data
- Passwords are hashed by Firebase
- All data transmitted over HTTPS
- Firebase provides DDoS protection

## Migrating Existing LocalStorage Data

If you have existing data in LocalStorage that you want to migrate to Firebase:

1. Open your app in the browser (old version)
2. Open Developer Console (F12)
3. Run:
```javascript
const data = {
  familyMembers: JSON.parse(localStorage.getItem('familyMembers')),
  bills: JSON.parse(localStorage.getItem('bills')),
  settings: JSON.parse(localStorage.getItem('settings'))
};
console.log(JSON.stringify(data));
```
4. Copy the output
5. After logging into the new Firebase version, run:
```javascript
// Paste your data here
const oldData = { /* paste here */ };
familyMembers = oldData.familyMembers;
bills = oldData.bills;
settings = oldData.settings;
await saveData();
```

## Troubleshooting

**Problem**: "Firebase not defined"
- **Solution**: Make sure firebase-config.js is loaded before script.js

**Problem**: "Permission denied"
- **Solution**: Check Firestore security rules

**Problem**: "Auth error"
- **Solution**: Verify email/password is enabled in Firebase Console

**Problem**: Data not saving
- **Solution**: Check browser console for errors, verify Firestore rules

## Support

For issues, check:
- [Firebase Documentation](https://firebase.google.com/docs)
- [Firebase Status](https://status.firebase.google.com)
- Browser console for error messages

## Next Steps

Consider adding:
- Password reset functionality
- Email verification
- Social login (Google, Facebook)
- Data export feature
- Real-time sync between devices
