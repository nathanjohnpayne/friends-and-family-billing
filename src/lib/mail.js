/**
 * Mail queue helper — writes email requests to Firestore's mailQueue collection.
 * A Cloud Function (processMailQueue) picks them up and sends via Resend.
 * The client listens for status updates on the document.
 */
import { collection, addDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase.js';

/**
 * Queue an email for delivery via the Firestore mail queue.
 * Returns a promise that resolves when the email is sent (or rejects on error).
 *
 * @param {{ to: string, subject: string, body: string, html?: string, replyTo?: string, uid: string }} params
 * @returns {Promise<{ id: string }>} — resolves with the Resend email ID
 */
export async function queueEmail({ to, subject, body, html, replyTo, uid }) {
    const docRef = await addDoc(collection(db, 'mailQueue'), {
        to,
        subject,
        body,
        ...(html ? { html } : {}),
        ...(replyTo ? { replyTo } : {}),
        uid,
        status: 'pending',
        createdAt: serverTimestamp()
    });

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            unsubscribe();
            reject(new Error('Email delivery timed out after 30 seconds.'));
        }, 30000);

        const unsubscribe = onSnapshot(docRef, snap => {
            const data = snap.data();
            if (!data) return;

            if (data.status === 'sent') {
                clearTimeout(timeout);
                unsubscribe();
                resolve({ id: data.resendId || docRef.id });
            } else if (data.status === 'error') {
                clearTimeout(timeout);
                unsubscribe();
                reject(new Error(data.error || 'Email delivery failed.'));
            }
            // status === 'pending' or 'processing' — still waiting
        }, err => {
            clearTimeout(timeout);
            reject(new Error('Lost connection while waiting for email status: ' + err.message));
        });
    });
}
