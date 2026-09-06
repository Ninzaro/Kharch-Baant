package com.kharchbaant.app

import android.app.Application
import android.content.Context
import android.util.Log
import com.clerk.api.Clerk
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Initializes clerk-android exactly once per process.
 * Publishable key is injected at Gradle build time from VITE_CLERK_PUBLISHABLE_KEY.
 */
class KharchBaantApp : Application() {
    override fun onCreate() {
        super.onCreate()
        initializeClerkOnce(this, getString(R.string.clerk_publishable_key))
    }

    companion object {
        private const val TAG = "ClerkNativeAuth"
        private val initializeStarted = AtomicBoolean(false)

        fun initializeClerkOnce(context: Context, publishableKey: String) {
            val key = publishableKey.trim()
            if (!key.startsWith("pk_")) {
                Log.i(TAG, "clerk-android skip initialize: missing publishable key")
                return
            }
            if (!initializeStarted.compareAndSet(false, true)) {
                Log.i(TAG, "clerk-android initialize skipped (already started)")
                return
            }
            Clerk.initialize(context.applicationContext, key)
            Log.i(TAG, "clerk-android initialize started")
        }
    }
}
