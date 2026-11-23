import React, { useEffect, useRef } from 'react';
import './TermsPrivacyModal.css';

const FOCUSABLE_SELECTOR = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export default function TermsPrivacyModal({ initialSection, returnFocusRef, onClose }) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const termsSectionRef = useRef(null);
  const privacySectionRef = useRef(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = returnFocusRef?.current || document.activeElement;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusableElements = Array.from(dialogRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) || []);
      if (!focusableElements.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && (document.activeElement === firstElement || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && (document.activeElement === lastElement || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    if (initialSection === 'privacy') privacySectionRef.current?.scrollIntoView?.({ block: 'start' });
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus?.();
    };
  }, [initialSection, onClose]);

  const closeOnBackdrop = (event) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div className="login-legal-modal-backdrop" onMouseDown={closeOnBackdrop}>
      <section
        ref={dialogRef}
        className="login-legal-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-legal-modal-title"
        aria-describedby="login-legal-modal-updated"
        tabIndex="-1"
      >
        <header className="login-legal-modal-header">
          <div>
            <p className="login-legal-modal-eyebrow">HEALTHSYNC POLICIES</p>
            <h2 id="login-legal-modal-title">Terms of Use and Privacy Policy for HealthSync</h2>
            <p id="login-legal-modal-updated">Last Updated: <time dateTime="2026-11-23">November 23, 2026</time></p>
          </div>
          <button ref={closeButtonRef} className="login-legal-modal-icon-button" type="button" aria-label="Close Terms of Use and Privacy Policy" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>

        <div className="login-legal-modal-content">
          <p className="login-legal-intro">
            Welcome to HealthSync, a web-based Community Health Records and Nutrition Monitoring Information System developed as an academic capstone project for Barangay Estancia, Kalibo, Aklan. By logging into or using this system, you agree to comply with the following Terms of Use and Privacy Policy.
          </p>

          <section ref={termsSectionRef} id="healthsync-terms-of-use" className="login-legal-part" aria-labelledby="healthsync-terms-heading">
            <h3 id="healthsync-terms-heading">PART I: TERMS OF USE</h3>

            <section className="login-legal-item">
              <h4>1. Authorized Users Only</h4>
              <p>Access to HealthSync is strictly restricted to verified personnel of Barangay Estancia and the capstone development team:</p>
              <ul>
                <li>System Administrators</li>
                <li>Barangay Health Workers (BHWs)</li>
                <li>Authorized Barangay Officials</li>
              </ul>
              <p>Residents and the general public do not have direct login access to this system.</p>
            </section>

            <section className="login-legal-item">
              <h4>2. Account Security and Accountability</h4>
              <ul>
                <li>You are responsible for keeping your username and password strictly confidential. Sharing accounts is prohibited.</li>
                <li>All actions performed under your account (adding, viewing, editing, or generating reports) are logged and tied to your user profile.</li>
                <li>You must immediately notify the System Administrator if you suspect unauthorized access to your account.</li>
              </ul>
            </section>

            <section className="login-legal-item">
              <h4>3. Acceptable Use</h4>
              <p>Users agree to use HealthSync strictly for official community health profiling, maternal and child health tracking, and nutrition monitoring. Users must not:</p>
              <ul>
                <li>Encode false or fabricated records (except when using designated dummy data during academic testing).</li>
                <li>Access resident records outside the scope of their official duties.</li>
                <li>Download, print, screenshot, or share resident data with unauthorized third parties.</li>
              </ul>
            </section>

            <section className="login-legal-item">
              <h4>4. Academic Capstone &amp; Medical Disclaimer</h4>
              <ul>
                <li><strong>Academic Project:</strong> HealthSync was created by Denmark Jay O. Espino, Allysa Jade A. Hilado, Christian O. Figueroa, Darren D. Casalmer, Edjiel Ann C. Ilisan, and Michael P. Manocan from Garcia College of Technology as a capstone project. The system is provided on an &quot;as-is&quot; basis for operational evaluation.</li>
                <li><strong>Not Medical Advice:</strong> HealthSync is a record-keeping and monitoring tool—not a substitute for professional clinical judgment. Automated indicators (such as BMI status or malnutrition flags) must be verified by a licensed physician, nurse, or midwife prior to any medical intervention.</li>
              </ul>
            </section>

            <section className="login-legal-item">
              <h4>5. Intellectual Property and Liability</h4>
              <ul>
                <li><strong>Software:</strong> The HealthSync codebase, design, and system architecture belongs to Denmark Jay O. Espino, Allysa Jade A. Hilado, Christian O. Figueroa, Darren D. Casalmer, Edjiel Ann C. Ilisan, and Michael P. Manocan and Garcia College of Technology, subject to school policies.</li>
                <li><strong>Data Ownership:</strong> All resident records belong exclusively to Barangay Estancia, Kalibo, Aklan.</li>
                <li><strong>Liability:</strong> The student developers, advisers, and school are not liable for service interruptions (e.g., power or internet outages) or clinical decisions made using the system.</li>
              </ul>
            </section>

            <section className="login-legal-item">
              <h4>6. Termination of Access</h4>
              <p>The System Administrator or Barangay Estancia officials may suspend or revoke access at any time if a user violates these terms or concludes their official duty at the barangay.</p>
            </section>
          </section>

          <section ref={privacySectionRef} id="healthsync-privacy-policy" className="login-legal-part" aria-labelledby="healthsync-privacy-heading">
            <h3 id="healthsync-privacy-heading">PART II: PRIVACY POLICY (RA 10173 COMPLIANCE)</h3>
            <p>HealthSync adheres to the Data Privacy Act of 2012 (Republic Act No. 10173) of the Philippines to protect the personal and sensitive health information of Barangay Estancia residents.</p>

            <section className="login-legal-item">
              <h4>7. Information Collected</h4>
              <ul>
                <li><strong>System Users (BHWs/Officials):</strong> Full name, role/position, contact details, login credentials, and system activity logs.</li>
                <li><strong>Barangay Residents (Encoded by Staff):</strong> Demographic details (name, age, sex, birthdate, address/purok), anthropometric measurements (height, weight, BMI), immunization records, maternal health data, and general health/nutrition status.</li>
              </ul>
            </section>

            <section className="login-legal-item">
              <h4>8. Purpose of Data Collection</h4>
              <p>Collected data is used exclusively to:</p>
              <ul>
                <li>Maintain accurate digital community health and nutrition records for Barangay Estancia.</li>
                <li>Monitor child growth, malnutrition trends, and maternal health programs.</li>
                <li>Generate official health summaries and reports for the Barangay Health Center and the Municipal Health Office of Kalibo.</li>
              </ul>
            </section>

            <section className="login-legal-item">
              <h4>9. Consent and Data Handling</h4>
              <ul>
                <li>Before encoding any resident’s information into HealthSync, authorized barangay personnel must secure informed consent from the resident (or parent/guardian, in the case of minors).</li>
                <li>Data is never sold, shared for commercial purposes, or disclosed to external parties without legal authorization or explicit resident consent.</li>
              </ul>
            </section>

            <section className="login-legal-item">
              <h4>10. Data Security and Retention</h4>
              <ul>
                <li>HealthSync implements role-based access control (RBAC), password encryption, and audit logs to safeguard records against unauthorized access or alteration.</li>
                <li>Records are retained only for as long as necessary to fulfill barangay health monitoring requirements or as mandated by Department of Health (DOH) guidelines.</li>
              </ul>
            </section>

            <section className="login-legal-item">
              <h4>11. Rights of Data Subjects</h4>
              <p>Under RA 10173, Barangay Estancia residents have the right to be informed, access their records, request corrections to inaccurate data, and object to the processing of their personal information through the Barangay Health Center.</p>
            </section>

            <section className="login-legal-item">
              <h4>12. Contact Information</h4>
              <p>For technical support, privacy inquiries, or data correction requests, please contact:</p>
              <ul>
                <li><strong>System Administrator / Capstone Team:</strong> Denmark Jay O. Espino – <a href="mailto:densane07@gmail.com">densane07@gmail.com</a></li>
                <li><strong>Barangay Health Office:</strong> Barangay Estancia Health Center, Estancia, Kalibo, Aklan</li>
              </ul>
            </section>
          </section>
        </div>

        <footer className="login-legal-modal-footer">
          <span>By continuing to log in, you acknowledge these policies.</span>
          <button type="button" className="login-legal-modal-close" onClick={onClose}>Close</button>
        </footer>
      </section>
    </div>
  );
}
