# 🔔 Setup Push Notifications (Backend Functions)

## Step 1: Get VAPID Key from Firebase Console
1. Go to: console.firebase.google.com/project/mustafa-app-c7174/settings/cloudmessaging
2. In "Web Push certificates", click **Generate key pair**
3. Copy the key
4. In `src/services/fcmService.ts`, replace `BLBz_placeholder_replace_with_real_vapid_key` with your key

## Step 2: Deploy Cloud Functions
```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Select project
firebase use mustafa-app-c7174

# Deploy functions
cd functions
npm install
cd ..
firebase deploy --only functions
```

## Step 3: Firestore Rules for fcm_tokens
Add to Firebase Console > Firestore > Rules:
```
match /fcm_tokens/{userId} {
  allow write: if true;
  allow read: if false; // only functions can read
}
```

## What happens after setup:
- ✅ New Alert → notification to ALL users (even app closed)
- ✅ New SOS → emergency notification to ALL users
- ✅ New Task → notification to the assigned guard only
- ✅ New Report → notification to owner + admins
- ✅ New account request → notification to owner
