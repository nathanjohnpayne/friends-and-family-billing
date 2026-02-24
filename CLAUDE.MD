# Project Overview

## Description
Family Bill Splitter - A cloud-based web application for managing and splitting monthly bills among family members. Features multi-user authentication, flexible bill splitting, parent-child account linking, payment tracking, and email invoicing with annual summaries.

**Live Application:** https://friends-and-family-billing.web.app

## Tech Stack
- **Frontend:** HTML5, CSS3, JavaScript (Vanilla)
- **Backend:** Firebase
  - Firebase Authentication (Email/Password + Google Sign-In)
  - Cloud Firestore (NoSQL database)
  - Firebase Hosting
- **Data Persistence:** Cloud Firestore with per-user data isolation
- **Image Processing:** Canvas API for compression (max 200x200px PNG)

## Project Structure
```
.
├── index.html              # Main application (requires authentication)
├── login.html              # Login/signup page with Google Sign-In
├── styles.css              # Application styles
├── script.js               # Main application logic
├── auth.js                 # Authentication handling
├── firebase-config.js      # Firebase initialization
├── firestore.rules         # Database security rules
├── firebase.json           # Firebase hosting configuration
├── check_data.html         # Data verification tool
├── DEPLOYMENT.md           # Detailed deployment guide
├── QUICKSTART.md           # Fast 10-minute setup guide
├── FIREBASE_IMPLEMENTATION.md  # Implementation details
└── CLAUDE.md               # This file

Deployed to: Firebase Hosting
Project ID: friends-and-family-billing
```

## Key Concepts

### Core Features
- **Bill**: A recurring monthly expense with a fixed amount, optional logo, and website URL
- **Family Member**: A person with avatar, email, and payment tracking
- **Parent-Child Linking**: Link family members to combine invoices and split payments proportionally
- **Payment Tracking**: Editable payment fields with automatic balance calculation
- **Email Invoicing**: Plain-text invoices via mailto with customizable messages and %total placeholder
- **Multi-User Support**: Secure cloud storage with user authentication

### Data Model
- **Bill Splitting**: Select which family members participate in each bill
- **Proportional Payments**: Payments distributed based on what each person owes
- **Annual Summary**: Automatically calculates yearly totals with payment tracking
- **Hierarchical Display**: Parent members shown with linked children indented below

## Development Setup

### Prerequisites
- Modern web browser (Chrome, Firefox, Safari, or Edge)
- Firebase CLI: `npm install -g firebase-tools`
- Firebase account (free tier supported)

### Local Development
```bash
# Clone or download the repository
cd "Claude Code"

# Login to Firebase
firebase login

# Link to Firebase project
firebase use friends-and-family-billing

# Serve locally
firebase serve

# Deploy to production
firebase deploy
```

### First-Time Setup
See `QUICKSTART.md` for detailed 10-minute setup instructions.

## Architecture & Patterns

### Authentication Flow
1. User visits app → Redirected to `login.html` if not authenticated
2. Login via Email/Password or Google Sign-In
3. `auth.onAuthStateChanged()` detects login → Loads user-specific data from Firestore
4. All operations scoped to current user's Firestore document

### Data Architecture
- **Firestore Structure:**
  ```
  /users/{userId}
    ├── familyMembers: Array
    ├── bills: Array
    ├── settings: Object
    └── updatedAt: Timestamp
  ```

- **Security:** Firestore rules ensure users can only access their own data
- **Image Storage:** Base64-encoded PNGs compressed to 200x200px max
- **Payment Distribution:** Proportional calculation based on individual totals

### Key Functions
- `loadData()`: Async function to fetch user data from Firestore
- `saveData()`: Async function to persist changes to Firestore
- `calculateAnnualSummary()`: Computes yearly totals for all members
- `updatePayment()`: Distributes payments proportionally to linked members
- `importFromLocalStorage()`: Migrates old LocalStorage data to Firebase

## Dependencies

### Firebase SDK (v10.7.1)
- `firebase-app-compat.js` - Core Firebase functionality
- `firebase-auth-compat.js` - Authentication (Email/Password, Google)
- `firebase-firestore-compat.js` - Cloud Firestore database

### Why Compat Libraries?
Using compatibility libraries for easier migration and broader browser support.

## Features

### User Management
- ✅ Email/Password authentication
- ✅ Google Sign-In integration
- ✅ Secure logout
- ✅ Per-user data isolation

### Family Member Management
- ✅ Add/edit/delete family members
- ✅ Upload avatars (PNG/JPG) with automatic compression
- ✅ Email addresses for invoicing
- ✅ Parent-child linking for combined invoices
- ✅ Payment tracking with editable fields

### Bill Management
- ✅ Add/edit/delete bills
- ✅ Upload logos (PNG/JPG) with automatic compression
- ✅ Website URLs for each service
- ✅ Flexible member selection (choose who splits each bill)
- ✅ Monthly amount with automatic annual calculation

### Invoicing & Reporting
- ✅ Annual summary with monthly and yearly totals
- ✅ Payment tracking with balance calculation
- ✅ Individual email invoices (plain text via mailto)
- ✅ Customizable email message with %total placeholder
- ✅ Combined invoices for parent + linked members

### Data Management
- ✅ Import from LocalStorage (migration tool)
- ✅ Data repair tools for integrity issues
- ✅ Clear all data option
- ✅ Real-time cloud sync across devices

## Deployment

### Production URL
https://friends-and-family-billing.web.app

### Deployment Process
```bash
# Deploy everything
firebase deploy

# Deploy only hosting
firebase deploy --only hosting

# Deploy only firestore rules
firebase deploy --only firestore:rules
```

### Environment
- **Hosting:** Firebase Hosting with CDN
- **Database:** Cloud Firestore (production mode)
- **Authentication:** Firebase Auth with authorized domains
- **Region:** Automatic (Firebase-managed)

See `DEPLOYMENT.md` for complete deployment instructions.

## Security

### Firestore Security Rules
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### Authentication Requirements
- All pages except `login.html` require authentication
- Users can only access their own data
- No cross-user data visibility

## Known Issues & Fixes

### Fixed Bugs
1. ✅ Duplicate member IDs causing bills to show 16 members instead of 8
2. ✅ Avatar upload limited to 2 images (LocalStorage quota)
3. ✅ Black backgrounds on logos (JPEG transparency issue)
4. ✅ Data not loading after refresh (async/await issue)
5. ✅ Linked member payment math showing incorrect credits

### Current Limitations
- Email invoices use `mailto:` links (requires email client)
- Images stored as base64 in Firestore (quota limits apply)
- No PDF generation (uses plain text email)

## Troubleshooting

### Data Not Loading
1. Hard refresh: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
2. Check browser console for errors
3. Verify Firebase config in `firebase-config.js`
4. Use `check_data.html` to verify data exists in Firestore

### Authentication Issues
1. Check authorized domains in Firebase Console
2. Enable Email/Password and Google providers
3. Clear browser cache
4. Check browser console for specific error codes

### Payment Calculation Issues
1. Use "Repair Data" button in Data Management section
2. Re-enter payment amounts to trigger recalculation
3. Verify linked members are set up correctly

## Additional Context

### Migration from LocalStorage
The app originally used LocalStorage for data persistence. Firebase migration provides:
- Multi-user support with authentication
- Cloud sync across devices
- Better scalability and data limits
- Secure user data isolation

Use the "Import from LocalStorage" button to migrate old data.

### Image Compression
All uploaded images (avatars and logos) are automatically compressed to 200x200px max and converted to PNG format to:
- Prevent LocalStorage/Firestore quota issues
- Maintain transparency in logos
- Ensure consistent sizing across UI

### Payment Distribution Logic
When a payment is entered for a parent with linked members:
1. Calculate total owed by parent + all linked members
2. Distribute payment proportionally based on individual totals
3. Update each person's `paymentReceived` field
4. Display individual balances

Example:
- Parent owes $1000, Child owes $500 (Total: $1500)
- Payment of $900 is distributed:
  - Parent: $900 × ($1000/$1500) = $600
  - Child: $900 × ($500/$1500) = $300
