# Family Bill Splitter

A cloud-based web application for managing and splitting monthly bills among family members with multi-user authentication, parent-child account linking, payment tracking, and email invoicing.

**🌐 Live Application:** [https://friends-and-family-billing.web.app](https://friends-and-family-billing.web.app)

![Family Bill Splitter](https://img.shields.io/badge/status-live-success)
![Firebase](https://img.shields.io/badge/firebase-hosting-orange)
![License](https://img.shields.io/badge/license-MIT-blue)

## Features

### 👥 User Management
- ✅ Email/Password authentication
- ✅ Google Sign-In integration
- ✅ Secure logout
- ✅ Per-user data isolation
- ✅ Cloud sync across devices

### 👨‍👩‍👧‍👦 Family Member Management
- ✅ Add/edit/delete family members
- ✅ Upload custom avatars (PNG/JPG) with automatic compression to 200x200px
- ✅ Automatic initials generation for members without avatars
- ✅ Email addresses for invoicing
- ✅ Parent-child linking for combined invoices
- ✅ Payment tracking with editable fields
- ✅ Proportional payment distribution for linked members

### 💰 Bill Management
- ✅ Add/edit/delete bills with monthly amounts
- ✅ Upload service logos (PNG/JPG) with compression
- ✅ Website URLs for each service
- ✅ Flexible member selection per bill (checkbox interface)
- ✅ Automatic annual calculation
- ✅ Logo management with fallback to service name display

### 📊 Bill Splitting & Calculations
- ✅ Even splits - divides bill amount equally among selected members
- ✅ Real-time calculations for monthly and annual totals
- ✅ Visual feedback with logos and avatars throughout
- ✅ Proportional payment distribution for linked family members

### 📧 Invoicing & Reporting
- ✅ Annual summary with monthly and yearly totals
- ✅ Payment tracking with automatic balance calculation
- ✅ Individual email invoices (plain text via mailto)
- ✅ Customizable email messages with %total placeholder
- ✅ Combined invoices for parent + linked members
- ✅ Hierarchical display showing parent-child relationships

### 🔧 Data Management
- ✅ Import from LocalStorage (migration tool)
- ✅ Data repair tools for integrity issues
- ✅ Clear all data option
- ✅ Real-time cloud sync across devices
- ✅ Data verification tool (check_data.html)
- ✅ Cloud Firestore persistence with per-user isolation

## Quick Start

### For Users

1. Visit [https://friends-and-family-billing.web.app](https://friends-and-family-billing.web.app)
2. Create an account or sign in with Google
3. Add family members with avatars
4. Add monthly bills with logos
5. Assign bills to family members
6. Track payments and send invoices

### For Developers

```bash
# Clone the repository
git clone <repository-url>
cd "Claude Code"

# Install Firebase CLI
npm install -g firebase-tools

# Login to Firebase
firebase login

# Link to project
firebase use friends-and-family-billing

# Deploy
firebase deploy
```

### Uploading Images

**Avatars (Family Members):**
- Click the camera icon (📷) next to any family member
- Select a PNG or JPG file
- Image is automatically converted and saved
- Displays as a circle (48x48px)
- If no image: shows initials in a purple circle

**Logos (Bills/Services):**
- Click "Upload Logo" button on any bill
- Select a PNG or JPG file
- Image is automatically converted and saved
- Displays as a rectangle (80x60px)
- If no image: shows service name in a styled box

### Generating Invoices

**Annual Invoice (All Members):**
- Click "Generate Annual Invoice" button at bottom
- Opens new window with complete breakdown
- Click "Print Invoice" to save as PDF
- Includes all avatars and logos

**Individual Invoice (One Member):**
- Click "Email Invoice" next to any family member in summary table
- Invoice opens in new window with that member's bills only
- Click "Print as PDF" button
- Follow instructions to email:
  1. Print/save the page as PDF
  2. Click OK on alert dialog
  3. Email client opens with pre-filled subject and message
  4. Attach the PDF you just saved
  5. Send email

### Email Settings
- Scroll to "Email Settings" section
- Edit the message sent with all invoices
- Message appears in email body and on printed invoices
- Uses member's first name in greeting
- Click "Save Message" to update

## Technical Details

### Image Storage
- Images converted to base64 data URLs
- Stored directly in LocalStorage (no server required)
- PNG and JPG formats supported
- Automatically processed on upload

### Image Display
- **Avatars**: 48x48px circles in UI, 32x32px in invoices
- **Logos**: 80x60px rectangles in UI, 40x30px in invoices
- CSS `object-fit` ensures proper scaling
- No distortion regardless of source image dimensions

### Email System
Since this is a browser-based app with no backend:
- Uses `mailto:` links to open email client
- User must manually save invoice as PDF
- Email pre-filled with subject, greeting, and message
- Works with any desktop email client

### Data Structure
```javascript
{
  familyMembers: [
    {
      id: number,
      name: string,
      email: string,
      avatar: string (base64 data URL)
    }
  ],
  bills: [
    {
      id: number,
      name: string,
      amount: number,
      website: string,
      logo: string (base64 data URL),
      members: [memberIds]
    }
  ],
  settings: {
    emailMessage: string
  }
}
```

## Browser Compatibility
- Works in all modern browsers (Chrome, Firefox, Safari, Edge)
- Requires JavaScript enabled
- Uses LocalStorage API
- FileReader API for image upload
- No server or build tools needed

## Example Use Cases

**T-Mobile Bill ($300/month):**
- Upload T-Mobile logo
- Add website: https://t-mobile.com
- Select all 8 family members
- Each person pays $37.50/month ($450/year)

**Apple One ($37.95/month):**
- Upload Apple logo
- Add website: https://apple.com/apple-one
- Select 4 family members
- Each person pays $9.49/month ($113.85/year)

## Tips
- Upload high-quality logos for best print results
- Keep email message concise and professional
- Review summary before generating invoices
- Save invoices as PDFs for record-keeping
- Update amounts when prices change
- Add/remove members as family changes

## Tech Stack

- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Backend:** Firebase
  - Authentication (Email/Password + Google)
  - Cloud Firestore (NoSQL database)
  - Firebase Hosting with CDN
- **Image Processing:** Canvas API (200x200px PNG compression)

## Security

- **Firestore Rules:** Per-user data isolation
- **HTTPS:** All data transmitted securely
- **Password Hashing:** Firebase handles authentication
- **Image Compression:** Prevents quota issues
- **No Cross-User Access:** Users can only see their own data

## Documentation

- **[CLAUDE.md](CLAUDE.md)** - Comprehensive project documentation
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Detailed deployment instructions
- **[QUICKSTART.md](QUICKSTART.md)** - Fast 10-minute setup
- **[FIREBASE_IMPLEMENTATION.md](FIREBASE_IMPLEMENTATION.md)** - Firebase migration details

## Troubleshooting

### Data Not Loading
1. Hard refresh: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
2. Check browser console for errors
3. Verify you're logged in
4. Use `check_data.html` to verify Firebase data

### Authentication Issues
1. Check Firebase Console for enabled auth providers
2. Verify authorized domains include deployment URL
3. Clear browser cache
4. Check console for specific error codes

### Payment Calculations
1. Use "Repair Data" button in Data Management
2. Re-enter payment amounts
3. Verify linked members are configured correctly

## Migration from LocalStorage

If you used the app before Firebase integration:

1. Log into https://friends-and-family-billing.web.app
2. Scroll to "Data Management" section
3. Click "Import from LocalStorage"
4. Your old data will be migrated to Firebase

## Cost

### Firebase Free Tier
- 50,000 database reads/day
- 20,000 database writes/day
- 1 GB storage
- 10 GB/month hosting transfer

**Perfect for families!** You'd need thousands of daily users to exceed the free tier.

## Changelog

### Latest Updates (2026-01)
- ✅ Added Google Sign-In authentication
- ✅ Fixed proportional payment distribution for linked members
- ✅ Fixed logo black background issue (PNG compression)
- ✅ Fixed data loading issue (async/await)
- ✅ Added LocalStorage migration tool
- ✅ Added data verification tool
- ✅ Added cache-control headers

### Firebase Migration (2025)
- ✅ Multi-user authentication
- ✅ Cloud Firestore storage
- ✅ Firebase Hosting deployment
- ✅ Security rules implementation
- ✅ Cross-device sync

### Original Features
- ✅ Bill and member management
- ✅ Avatar and logo uploads
- ✅ Parent-child linking
- ✅ Email invoicing
- ✅ Payment tracking
- ✅ Annual summaries

## License

MIT License - feel free to use this for your own family bill splitting needs!

---

**Built with ❤️ for families who split bills**
