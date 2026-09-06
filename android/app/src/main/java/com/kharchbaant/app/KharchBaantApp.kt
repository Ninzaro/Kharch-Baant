package com.kharchbaant.app

import android.app.Application
import android.util.Log
import com.clerk.api.Clerk

/**
 * Initializes clerk-android as soon as the process starts.
 * Publishable key is injected at Gradle build time from VITE_CLERK_PUBLISHABLE_KEY.
 */
class KharchBaantApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val publishableKey = getString(R.string.clerk_publishable_key).trim()
        if (publishableKey.startsWith("pk_")) {
            Clerk.initialize(this, publishableKey)
            Log.i(TAG, "clerk-android initialized")
        } else {
            Log.i(TAG, "clerk-android will initialize from the Capacitor plugin")
        }
    }

    companion object {
        private const val TAG = "ClerkNativeAuth"
    }
}
