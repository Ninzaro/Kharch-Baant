package com.kharchbaant.app

import android.util.Log
import com.clerk.api.Clerk
import com.clerk.api.sso.OAuthProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

/**
 * Native Google OAuth (`oauth_google`) via clerk-android SSOManagerActivity,
 * then a short-lived session JWT for the WebView ticket bridge.
 *
 * Does not use google_one_tap, Capgo ID tokens, or Capacitor Browser.
 * ClerkResult is unwrapped in [ClerkResults] (Java).
 */
@CapacitorPlugin(name = "ClerkNativeAuth")
class ClerkNativeAuthPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    @PluginMethod
    fun signInWithGoogle(call: PluginCall) {
        val publishableKey = call.getString("publishableKey").orEmpty().trim()

        scope.launch {
            try {
                ensureClerkReady(publishableKey)
                authenticateNativeClerk()
                Log.i(TAG, "Native Clerk authentication succeeded")

                val jwt = ClerkResults.stringValue(Clerk.auth.getToken())
                if (jwt.isNullOrBlank()) {
                    call.reject("Failed to obtain native Clerk session token.")
                    return@launch
                }
                Log.i(TAG, "Native session token obtained")
                val ret = JSObject()
                ret.put("token", jwt)
                call.resolve(ret)
            } catch (e: Exception) {
                Log.e(
                    TAG,
                    "Native Clerk authentication failed: ${e.javaClass.simpleName}",
                    e
                )
                call.reject("Native Clerk authentication failed.")
            }
        }
    }

    private suspend fun ensureClerkReady(publishableKeyFromJs: String) {
        val currentActivity = activity
        if (currentActivity != null) {
            Clerk.attachActivity(currentActivity)
        }

        val key = if (publishableKeyFromJs.startsWith("pk_")) {
            publishableKeyFromJs
        } else {
            currentActivity?.getString(R.string.clerk_publishable_key).orEmpty().trim()
        }
        val context = currentActivity ?: bridge.context
        KharchBaantApp.initializeClerkOnce(context, key)

        if (currentActivity != null) {
            Clerk.attachActivity(currentActivity)
        }

        withTimeout(20_000) {
            Clerk.isInitialized.first { initialized -> initialized }
        }
    }

    /**
     * clerk-android oauth_google via SSOManagerActivity (not Capacitor Browser).
     * Callback is clerk://com.kharchbaant.app.callback on SSOReceiverActivity.
     */
    private suspend fun authenticateNativeClerk() {
        if (Clerk.activeSession != null) {
            Log.i(TAG, "Native Clerk already signed in; reusing session")
            return
        }

        try {
            Log.i(TAG, "Native Clerk oauth_google starting")
            val signInResult = Clerk.auth.signInWithOAuth(OAuthProvider.GOOGLE)
            val sessionId = if (ClerkResults.isSuccess(signInResult)) {
                ClerkResults.sessionIdFromSuccess(signInResult)
            } else {
                val signInCode = ClerkResults.failureCode(signInResult)
                Log.i(TAG, "Native Clerk oauth_google sign-in did not complete: $signInCode")
                if (ClerkResults.isSessionExists(signInCode)) {
                    Log.i(TAG, "Native Clerk already signed in; reusing session")
                    return
                }
                if (!ClerkResults.isAccountNotFound(signInCode)) {
                    throw IllegalStateException(
                        "Native Clerk authentication failed: ${ClerkResults.failureDetail(signInResult)}"
                    )
                }
                Log.i(TAG, "Native Clerk oauth_google sign-up fallback")
                val signUpResult = Clerk.auth.signUpWithOAuth(OAuthProvider.GOOGLE)
                if (!ClerkResults.isSuccess(signUpResult)) {
                    val signUpCode = ClerkResults.failureCode(signUpResult)
                    if (ClerkResults.isSessionExists(signUpCode)) {
                        Log.i(TAG, "Native Clerk already signed in; reusing session")
                        return
                    }
                    throw IllegalStateException(
                        "Native Clerk authentication failed: ${ClerkResults.failureDetail(signUpResult)}"
                    )
                }
                ClerkResults.sessionIdFromSuccess(signUpResult)
            }

            if (!sessionId.isNullOrBlank()) {
                Clerk.auth.setActive(sessionId = sessionId)
            }
        } catch (e: Exception) {
            if (e is IllegalStateException && e.message?.startsWith("Native Clerk authentication failed") == true) {
                throw e
            }
            throw IllegalStateException("Native Clerk authentication failed", e)
        }
    }

    companion object {
        private const val TAG = "ClerkNativeAuth"
    }
}
