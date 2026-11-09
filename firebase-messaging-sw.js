importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js','https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js','/config.js');
firebase.initializeApp(self.CFG.fb);
firebase.messaging(); // FCM shows notification-type messages automatically while the app is closed
