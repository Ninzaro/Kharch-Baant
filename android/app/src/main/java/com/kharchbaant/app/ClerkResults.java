package com.kharchbaant.app;

import com.clerk.api.network.serialization.ClerkResult;

/**
 * Unwraps clerk-android {@link ClerkResult} in Java.
 *
 * Kotlin K2 ICEs on {@code is ClerkResult.Success<*, *>} / {@code when} over that
 * generic sealed interface, then reading {@code .value} (star-projected captured type).
 */
final class ClerkResults {
    private ClerkResults() {}

    static boolean isSuccess(ClerkResult<?, ?> result) {
        return result instanceof ClerkResult.Success;
    }

    static String stringValue(ClerkResult<?, ?> result) {
        Object value = successValue(result);
        return value instanceof String ? (String) value : null;
    }

    static String sessionIdFromSuccess(ClerkResult<?, ?> result) {
        Object value = successValue(result);
        if (value == null) {
            return null;
        }
        String direct = createdSessionId(value);
        if (direct != null) {
            return direct;
        }
        String fromSignIn = createdSessionId(invokeNoArg(value, "getSignIn"));
        if (fromSignIn != null) {
            return fromSignIn;
        }
        return createdSessionId(invokeNoArg(value, "getSignUp"));
    }

    private static Object successValue(ClerkResult<?, ?> result) {
        if (!(result instanceof ClerkResult.Success)) {
            return null;
        }
        return ((ClerkResult.Success<?>) result).getValue();
    }

    private static String createdSessionId(Object target) {
        Object id = invokeNoArg(target, "getCreatedSessionId");
        return id instanceof String ? (String) id : null;
    }

    private static Object invokeNoArg(Object target, String methodName) {
        if (target == null) {
            return null;
        }
        try {
            return target.getClass().getMethod(methodName).invoke(target);
        } catch (Exception ignored) {
            return null;
        }
    }
}
