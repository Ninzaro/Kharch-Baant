package com.kharchbaant.app

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
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
        registerActivityLifecycleCallbacks(ClerkCallbackShapeLogger)
        initializeClerkOnce(this, getString(R.string.clerk_publishable_key))
    }

    private object ClerkCallbackShapeLogger : ActivityLifecycleCallbacks {
        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
            if (activity.javaClass.name != "com.clerk.api.sso.SSOReceiverActivity") return

            val uri = activity.intent?.data ?: return
            val parameterNames = runCatching { uri.queryParameterNames.sorted() }
                .getOrDefault(emptyList())
                .joinToString(",")
                .ifEmpty { "<none>" }
            Log.i(
                TAG,
                "Clerk OAuth callback shape: " +
                    "schemeIsClerk=${uri.scheme == "clerk"}, " +
                    "hostMatchesExpected=${uri.host == "${activity.packageName}.callback"}, " +
                    "pathPresent=${!uri.path.isNullOrEmpty()}, " +
                    "fragmentPresent=${!uri.fragment.isNullOrEmpty()}, " +
                    "queryParameterNames=$parameterNames"
            )
        }

        override fun onActivityStarted(activity: Activity) = Unit
        override fun onActivityResumed(activity: Activity) = Unit
        override fun onActivityPaused(activity: Activity) = Unit
        override fun onActivityStopped(activity: Activity) = Unit
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
        override fun onActivityDestroyed(activity: Activity) = Unit
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
