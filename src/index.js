import {
    // Constants
    CURRENT_MIGRATION_VERSION,
    PAYMENT_METHOD_LABELS,
    BILLING_YEAR_STATUSES,
    BILLING_EVENT_LABELS,
    PAYMENT_METHOD_ICONS,
    PAYMENT_METHOD_TYPES,
    DISPUTE_STATUS_LABELS,
    EVIDENCE_MAX_SIZE,
    EVIDENCE_MAX_COUNT,
    EVIDENCE_ALLOWED_TYPES,

    // Version checking
    checkForUpdate,
    showUpdateToast,
    dismissUpdateToast,
    startUpdateChecker,
    showChangeToast,

    // Persistence / data
    loadData,
    debugDataIntegrity,
    repairDuplicateIds,
    cleanupInvalidBillMembers,
    saveData,
    logout,
    migrateLegacyData,

    // Billing year lifecycle
    isArchivedYear,
    isClosedYear,
    isSettlingYear,
    isYearReadOnly,
    yearReadOnlyMessage,
    getBillingYearStatusLabel,
    setBillingYearStatus,
    loadBillingYearsList,
    loadBillingYearData,
    switchBillingYear,
    archiveCurrentYear,
    startNewYear,
    closeCurrentYear,
    renderBillingYearSelector,
    renderStatusBanner,
    renderArchivedBanner,

    // Utilities
    escapeHtml,
    sanitizeImageSrc,
    isValidE164,
    getInitials,
    generateAvatar,
    generateLogo,
    uploadImage,
    generateUniqueId,
    generateUniqueBillId,
    getPaymentMethodLabel,

    // Family member management
    addFamilyMember,
    editFamilyMember,
    editMemberEmail,
    editMemberPhone,
    uploadAvatar,
    removeAvatar,
    manageLinkMembers,
    isLinkedToAnyone,
    getParentMember,
    removeFamilyMember,
    renderFamilyMembers,

    // Billing event ledger
    generateEventId,
    emitBillingEvent,
    getBillingEventsForBill,
    getBillingEventsForMember,
    getBillingEventsForPayment,

    // Billing frequency helpers
    getBillAnnualAmount,
    getBillMonthlyAmount,
    getBillFrequencyLabel,
    setAddBillFrequency,
    getAddBillFrequency,
    updateBillAmountPreview,

    // Bill management
    addBill,
    editBillName,
    editBillAmount,
    toggleBillFrequency,
    editBillWebsite,
    showBillAuditHistory,
    uploadLogo,
    removeLogo,
    removeBill,
    toggleMember,
    renderBills,
    toggleBillSplit,
    toggleBillActionsMenu,

    // Calculations & summary
    calculateAnnualSummary,
    getCalculationBreakdown,
    toggleCalcBreakdown,
    getPaymentStatusBadge,
    calculateSettlementMetrics,
    toggleActionMenu,
    closeAllActionMenus,
    updateSummary,
    renderDashboardStatus,

    // Payments
    recordPayment,
    generateUniquePaymentId,
    getPaymentTotalForMember,
    getMemberPayments,
    migratePaymentReceivedToLedger,
    ensureDialogContainer,
    showAddPaymentDialog,
    updatePaymentPreview,
    toggleDistributePreview,
    submitPayment,
    closePaymentDialog,
    showPaymentHistory,
    deletePaymentEntry,

    // Email settings
    renderEmailSettings,
    saveEmailMessage,

    // Payment methods
    migratePaymentLinksToMethods,
    getPaymentMethodIcon,
    renderPaymentMethodsSettings,
    getPaymentMethodDetail,
    addPaymentMethod,
    editPaymentMethod,
    savePaymentMethodEdit,
    togglePaymentMethodEnabled,
    removePaymentMethod,
    getEnabledPaymentMethods,
    formatPaymentOptionsHTML,
    formatPaymentOptionsText,

    // Disputes
    normalizeDisputeStatus,
    disputeStatusClass,
    setDisputeFilter,
    loadDisputes,
    renderDisputeFilterBar,
    renderDisputes,
    getDisputeRef,
    updateDispute,
    showDisputeDetail,
    doDisputeAction,
    toggleUserReview,
    scrollToBill,
    scrollToMember,
    formatFileSize,
    uploadEvidence,
    viewEvidence,
    removeEvidence,

    // Share links
    computeMemberSummaryForShare,
    buildPublicShareData,
    refreshPublicShares,
    hashToken,
    generateRawToken,
    generateShareLink,
    doGenerateShareLink,
    showShareLinkSuccess,
    copyShareLinkUrl,
    showShareLinks,
    revokeShareLink,

    // Invoicing
    generateInvoice,
    getInvoiceSummaryContext,
    buildInvoiceSubject,
    buildInvoiceBody,
    buildFullInvoiceText,
    buildSmsDeepLink,
    openSmsComposer,
    updateInvoiceVariant,
    sendIndividualInvoice,
    showTextInvoiceDialog,
    generateShareLinkForInvoiceDialog,
    copyTextInvoiceMessage,
    copyTextInvoiceLink,
    showEmailInvoiceDialog,
    copyEmailInvoiceMessage,
    generateInvoiceHTML,

    // Test helpers
    _set,
    _get,
} from './main.js';

// ---------------------------------------------------------------------------
// Legacy window.* surface — keeps inline onclick handlers and test access
// working during the incremental modularization transition.
// ---------------------------------------------------------------------------

// Constants
window.CURRENT_MIGRATION_VERSION = CURRENT_MIGRATION_VERSION;
window.PAYMENT_METHOD_LABELS = PAYMENT_METHOD_LABELS;
window.BILLING_YEAR_STATUSES = BILLING_YEAR_STATUSES;
window.BILLING_EVENT_LABELS = BILLING_EVENT_LABELS;
window.PAYMENT_METHOD_ICONS = PAYMENT_METHOD_ICONS;
window.PAYMENT_METHOD_TYPES = PAYMENT_METHOD_TYPES;
window.DISPUTE_STATUS_LABELS = DISPUTE_STATUS_LABELS;
window.EVIDENCE_MAX_SIZE = EVIDENCE_MAX_SIZE;
window.EVIDENCE_MAX_COUNT = EVIDENCE_MAX_COUNT;
window.EVIDENCE_ALLOWED_TYPES = EVIDENCE_ALLOWED_TYPES;

// Version checking
window.checkForUpdate = checkForUpdate;
window.showUpdateToast = showUpdateToast;
window.dismissUpdateToast = dismissUpdateToast;
window.startUpdateChecker = startUpdateChecker;
window.showChangeToast = showChangeToast;

// Persistence / data
window.loadData = loadData;
window.debugDataIntegrity = debugDataIntegrity;
window.repairDuplicateIds = repairDuplicateIds;
window.cleanupInvalidBillMembers = cleanupInvalidBillMembers;
window.saveData = saveData;
window.logout = logout;
window.migrateLegacyData = migrateLegacyData;

// Billing year lifecycle
window.isArchivedYear = isArchivedYear;
window.isClosedYear = isClosedYear;
window.isSettlingYear = isSettlingYear;
window.isYearReadOnly = isYearReadOnly;
window.yearReadOnlyMessage = yearReadOnlyMessage;
window.getBillingYearStatusLabel = getBillingYearStatusLabel;
window.setBillingYearStatus = setBillingYearStatus;
window.loadBillingYearsList = loadBillingYearsList;
window.loadBillingYearData = loadBillingYearData;
window.switchBillingYear = switchBillingYear;
window.archiveCurrentYear = archiveCurrentYear;
window.startNewYear = startNewYear;
window.closeCurrentYear = closeCurrentYear;
window.renderBillingYearSelector = renderBillingYearSelector;
window.renderStatusBanner = renderStatusBanner;
window.renderArchivedBanner = renderArchivedBanner;

// Utilities
window.escapeHtml = escapeHtml;
window.sanitizeImageSrc = sanitizeImageSrc;
window.isValidE164 = isValidE164;
window.getInitials = getInitials;
window.generateAvatar = generateAvatar;
window.generateLogo = generateLogo;
window.uploadImage = uploadImage;
window.generateUniqueId = generateUniqueId;
window.generateUniqueBillId = generateUniqueBillId;
window.getPaymentMethodLabel = getPaymentMethodLabel;

// Family member management
window.addFamilyMember = addFamilyMember;
window.editFamilyMember = editFamilyMember;
window.editMemberEmail = editMemberEmail;
window.editMemberPhone = editMemberPhone;
window.uploadAvatar = uploadAvatar;
window.removeAvatar = removeAvatar;
window.manageLinkMembers = manageLinkMembers;
window.isLinkedToAnyone = isLinkedToAnyone;
window.getParentMember = getParentMember;
window.removeFamilyMember = removeFamilyMember;
window.renderFamilyMembers = renderFamilyMembers;

// Billing event ledger
window.generateEventId = generateEventId;
window.emitBillingEvent = emitBillingEvent;
window.getBillingEventsForBill = getBillingEventsForBill;
window.getBillingEventsForMember = getBillingEventsForMember;
window.getBillingEventsForPayment = getBillingEventsForPayment;

// Billing frequency helpers
window.getBillAnnualAmount = getBillAnnualAmount;
window.getBillMonthlyAmount = getBillMonthlyAmount;
window.getBillFrequencyLabel = getBillFrequencyLabel;
window.setAddBillFrequency = setAddBillFrequency;
window.getAddBillFrequency = getAddBillFrequency;
window.updateBillAmountPreview = updateBillAmountPreview;

// Bill management
window.addBill = addBill;
window.editBillName = editBillName;
window.editBillAmount = editBillAmount;
window.toggleBillFrequency = toggleBillFrequency;
window.editBillWebsite = editBillWebsite;
window.showBillAuditHistory = showBillAuditHistory;
window.uploadLogo = uploadLogo;
window.removeLogo = removeLogo;
window.removeBill = removeBill;
window.toggleMember = toggleMember;
window.renderBills = renderBills;
window.toggleBillSplit = toggleBillSplit;
window.toggleBillActionsMenu = toggleBillActionsMenu;

// Calculations & summary
window.calculateAnnualSummary = calculateAnnualSummary;
window.getCalculationBreakdown = getCalculationBreakdown;
window.toggleCalcBreakdown = toggleCalcBreakdown;
window.getPaymentStatusBadge = getPaymentStatusBadge;
window.calculateSettlementMetrics = calculateSettlementMetrics;
window.toggleActionMenu = toggleActionMenu;
window.closeAllActionMenus = closeAllActionMenus;
window.updateSummary = updateSummary;
window.renderDashboardStatus = renderDashboardStatus;

// Payments
window.recordPayment = recordPayment;
window.generateUniquePaymentId = generateUniquePaymentId;
window.getPaymentTotalForMember = getPaymentTotalForMember;
window.getMemberPayments = getMemberPayments;
window.migratePaymentReceivedToLedger = migratePaymentReceivedToLedger;
window.ensureDialogContainer = ensureDialogContainer;
window.showAddPaymentDialog = showAddPaymentDialog;
window.updatePaymentPreview = updatePaymentPreview;
window.toggleDistributePreview = toggleDistributePreview;
window.submitPayment = submitPayment;
window.closePaymentDialog = closePaymentDialog;
window.showPaymentHistory = showPaymentHistory;
window.deletePaymentEntry = deletePaymentEntry;

// Email settings
window.renderEmailSettings = renderEmailSettings;
window.saveEmailMessage = saveEmailMessage;

// Payment methods
window.migratePaymentLinksToMethods = migratePaymentLinksToMethods;
window.getPaymentMethodIcon = getPaymentMethodIcon;
window.renderPaymentMethodsSettings = renderPaymentMethodsSettings;
window.getPaymentMethodDetail = getPaymentMethodDetail;
window.addPaymentMethod = addPaymentMethod;
window.editPaymentMethod = editPaymentMethod;
window.savePaymentMethodEdit = savePaymentMethodEdit;
window.togglePaymentMethodEnabled = togglePaymentMethodEnabled;
window.removePaymentMethod = removePaymentMethod;
window.getEnabledPaymentMethods = getEnabledPaymentMethods;
window.formatPaymentOptionsHTML = formatPaymentOptionsHTML;
window.formatPaymentOptionsText = formatPaymentOptionsText;

// Disputes
window.normalizeDisputeStatus = normalizeDisputeStatus;
window.disputeStatusClass = disputeStatusClass;
window.setDisputeFilter = setDisputeFilter;
window.loadDisputes = loadDisputes;
window.renderDisputeFilterBar = renderDisputeFilterBar;
window.renderDisputes = renderDisputes;
window.getDisputeRef = getDisputeRef;
window.updateDispute = updateDispute;
window.showDisputeDetail = showDisputeDetail;
window.doDisputeAction = doDisputeAction;
window.toggleUserReview = toggleUserReview;
window.scrollToBill = scrollToBill;
window.scrollToMember = scrollToMember;
window.formatFileSize = formatFileSize;
window.uploadEvidence = uploadEvidence;
window.viewEvidence = viewEvidence;
window.removeEvidence = removeEvidence;

// Share links
window.computeMemberSummaryForShare = computeMemberSummaryForShare;
window.buildPublicShareData = buildPublicShareData;
window.refreshPublicShares = refreshPublicShares;
window.hashToken = hashToken;
window.generateRawToken = generateRawToken;
window.generateShareLink = generateShareLink;
window.doGenerateShareLink = doGenerateShareLink;
window.showShareLinkSuccess = showShareLinkSuccess;
window.copyShareLinkUrl = copyShareLinkUrl;
window.showShareLinks = showShareLinks;
window.revokeShareLink = revokeShareLink;

// Invoicing
window.generateInvoice = generateInvoice;
window.getInvoiceSummaryContext = getInvoiceSummaryContext;
window.buildInvoiceSubject = buildInvoiceSubject;
window.buildInvoiceBody = buildInvoiceBody;
window.buildFullInvoiceText = buildFullInvoiceText;
window.buildSmsDeepLink = buildSmsDeepLink;
window.openSmsComposer = openSmsComposer;
window.updateInvoiceVariant = updateInvoiceVariant;
window.sendIndividualInvoice = sendIndividualInvoice;
window.showTextInvoiceDialog = showTextInvoiceDialog;
window.generateShareLinkForInvoiceDialog = generateShareLinkForInvoiceDialog;
window.copyTextInvoiceMessage = copyTextInvoiceMessage;
window.copyTextInvoiceLink = copyTextInvoiceLink;
window.showEmailInvoiceDialog = showEmailInvoiceDialog;
window.copyEmailInvoiceMessage = copyEmailInvoiceMessage;
window.generateInvoiceHTML = generateInvoiceHTML;

// Test helpers
window._set = _set;
window._get = _get;
