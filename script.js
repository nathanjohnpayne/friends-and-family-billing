// Data storage
let familyMembers = []; // Array of {id, name, email, avatar, paymentReceived, linkedMembers: [memberIds]}
let bills = []; // Array of {id, name, amount, logo, website, members: [memberIds]}
let settings = {
    emailMessage: 'I have attached your annual bill summary. Thank you for your prompt payment of %total via any of the payment services below.'
};

let currentUser = null;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    // Check authentication
    auth.onAuthStateChanged(async user => {
        if (!user) {
            // User is not logged in, redirect to login page
            window.location.href = 'login.html';
        } else {
            // User is logged in
            currentUser = user;
            document.getElementById('user-email').textContent = user.email;

            // Load user's data FIRST, then render
            await loadData();
            debugDataIntegrity(); // Debug function to check data
            renderFamilyMembers();
            renderBills();
            updateSummary();
            renderEmailSettings();
        }
    });
});

// Load data from Firestore
async function loadData() {
    if (!currentUser) return;

    try {
        const docRef = db.collection('users').doc(currentUser.uid);
        const doc = await docRef.get();

        if (doc.exists) {
            const data = doc.data();

            // Load family members
            if (data.familyMembers) {
                familyMembers = data.familyMembers.map(m => {
                    if (!m.email) m.email = '';
                    if (!m.avatar) m.avatar = '';
                    if (m.paymentReceived === undefined) m.paymentReceived = 0;
                    if (!m.linkedMembers) m.linkedMembers = [];
                    return m;
                });
            }

            // Load bills
            if (data.bills) {
                bills = data.bills.map(b => {
                    if (!b.logo) b.logo = '';
                    if (!b.website) b.website = '';
                    if (!b.members) b.members = [];
                    return b;
                });
            }

            // Load settings
            if (data.settings) {
                settings = data.settings;
            }

            // Repair data AFTER loading
            if (familyMembers.length > 0) {
                repairDuplicateIds();
            }
        } else {
            // No data yet, create initial document
            await saveData();
        }
    } catch (error) {
        console.error('Error loading data:', error);
        alert('Error loading your data. Please refresh the page.');
    }
}

// Debug function to check data integrity
function debugDataIntegrity() {
    console.log('=== DATA INTEGRITY CHECK ===');
    console.log('Family Members:', familyMembers.length);
    console.log('Member IDs:', familyMembers.map(m => m.id));
    console.log('Member Names:', familyMembers.map(m => m.name));

    bills.forEach(bill => {
        console.log(`Bill: ${bill.name}`);
        console.log(`  - Member IDs in bill:`, bill.members);
        console.log(`  - Number of members: ${bill.members.length}`);

        // Check for invalid member IDs
        const invalidIds = bill.members.filter(id => !familyMembers.some(m => m.id === id));
        if (invalidIds.length > 0) {
            console.warn(`  - WARNING: Invalid member IDs found:`, invalidIds);
        }
    });
    console.log('=== END CHECK ===');
}

// Repair duplicate member IDs and invalid bill references
function repairDuplicateIds() {
    const seenIds = new Set();
    const needsRepair = familyMembers.some(m => {
        if (seenIds.has(m.id)) {
            return true;
        }
        seenIds.add(m.id);
        return false;
    });

    if (needsRepair) {
        console.log('Repairing duplicate member IDs...');
        const idMap = {}; // Map old ID to new ID
        let baseId = Date.now();

        familyMembers.forEach((member, index) => {
            const oldId = member.id;
            const newId = baseId + index;
            member.id = newId;
            idMap[oldId] = newId;
        });

        // Update bills to reference new member IDs
        bills.forEach(bill => {
            bill.members = bill.members.map(memberId => idMap[memberId] || memberId);
        });

        saveData();
        console.log('Repair complete. Member IDs fixed.');
    }

    // Also clean up any invalid member references in bills
    cleanupInvalidBillMembers();
}

// Remove invalid member IDs from bills
function cleanupInvalidBillMembers() {
    const validMemberIds = new Set(familyMembers.map(m => m.id));
    let cleanedAny = false;

    bills.forEach(bill => {
        const originalLength = bill.members.length;
        bill.members = bill.members.filter(memberId => validMemberIds.has(memberId));

        if (bill.members.length !== originalLength) {
            console.log(`Cleaned invalid members from ${bill.name}: ${originalLength} -> ${bill.members.length}`);
            cleanedAny = true;
        }
    });

    if (cleanedAny) {
        saveData();
        console.log('Invalid bill member references cleaned up.');
    }
}

// Serialized write queue — each saveData() chains onto the previous write
// so concurrent calls never overwrite each other out of order.
let _saveChain = Promise.resolve();

function saveData() {
    if (!currentUser) return Promise.resolve();

    _saveChain = _saveChain.then(async () => {
        try {
            const docRef = db.collection('users').doc(currentUser.uid);
            await docRef.set({
                familyMembers: familyMembers,
                bills: bills,
                settings: settings,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log('Data saved successfully');
        } catch (error) {
            console.error('Error saving data:', error);
            alert('Error saving your data. Please try again.');
        }
    });
    return _saveChain;
}

// Logout function
function logout() {
    if (confirm('Are you sure you want to logout?')) {
        auth.signOut().then(() => {
            window.location.href = 'login.html';
        }).catch(error => {
            console.error('Logout error:', error);
            alert('Error logging out. Please try again.');
        });
    }
}

// Escape user-controlled strings before interpolating into HTML
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Only allow data: image URIs (produced by the Canvas compression pipeline).
// Rejects external URLs, javascript: schemes, and malformed values.
function sanitizeImageSrc(src) {
    if (!src) return '';
    if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(src)) return src;
    return '';
}

function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function generateAvatar(member) {
    const safeSrc = sanitizeImageSrc(member.avatar);
    if (safeSrc) {
        return `<img src="${safeSrc}" alt="${escapeHtml(member.name)}" class="avatar" />`;
    }
    return `<div class="avatar avatar-initials">${escapeHtml(getInitials(member.name))}</div>`;
}

function generateLogo(bill) {
    const safeSrc = sanitizeImageSrc(bill.logo);
    if (safeSrc) {
        return `<img src="${safeSrc}" alt="${escapeHtml(bill.name)}" class="logo" />`;
    }
    return `<div class="logo logo-text">${escapeHtml(bill.name)}</div>`;
}

// Helper: Upload image and convert to base64 (with compression)
function uploadImage(callback) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png, image/jpeg, image/jpg';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            // Create an image element to compress the file
            const img = new Image();
            const reader = new FileReader();

            reader.onload = (event) => {
                img.onload = () => {
                    // Create canvas for compression
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');

                    // Set max dimensions (for avatars/logos we don't need huge images)
                    const maxWidth = 200;
                    const maxHeight = 200;
                    let width = img.width;
                    let height = img.height;

                    // Calculate new dimensions while maintaining aspect ratio
                    if (width > height) {
                        if (width > maxWidth) {
                            height *= maxWidth / width;
                            width = maxWidth;
                        }
                    } else {
                        if (height > maxHeight) {
                            width *= maxHeight / height;
                            height = maxHeight;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;

                    // Fill with white background for JPEG (in case of transparency)
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, width, height);

                    // Draw image
                    ctx.drawImage(img, 0, 0, width, height);

                    // Use PNG format to preserve transparency (slightly larger but no black backgrounds)
                    const compressedBase64 = canvas.toDataURL('image/png');
                    callback(compressedBase64);
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    };
    input.click();
}

// Helper: Generate unique ID for members
function generateUniqueId() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const existingIds = familyMembers.map(m => m.id);
    let newId = timestamp + random;

    // Ensure uniqueness
    while (existingIds.includes(newId)) {
        newId++;
    }

    return newId;
}

// Helper: Generate unique ID for bills
function generateUniqueBillId() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const existingIds = bills.map(b => b.id);
    let newId = timestamp + random;

    // Ensure uniqueness
    while (existingIds.includes(newId)) {
        newId++;
    }

    return newId;
}

// Add family member
function addFamilyMember() {
    const input = document.getElementById('memberName');
    const emailInput = document.getElementById('memberEmail');
    const name = input.value.trim();
    const email = emailInput.value.trim();

    if (!name) {
        alert('Please enter a family member name');
        return;
    }

    if (familyMembers.some(m => m.name === name)) {
        alert('This family member already exists');
        return;
    }

    const member = {
        id: generateUniqueId(),
        name: name,
        email: email,
        avatar: '',
        paymentReceived: 0,
        linkedMembers: []
    };

    familyMembers.push(member);
    input.value = '';
    emailInput.value = '';

    saveData();
    renderFamilyMembers();
    renderBills();
    updateSummary();

    // Analytics: Track family member added
    if (analytics) {
        analytics.logEvent('family_member_added', {
            has_email: !!email,
            total_members: familyMembers.length
        });
    }
}

// Edit family member
function editFamilyMember(id) {
    const member = familyMembers.find(m => m.id === id);
    if (!member) return;

    const newName = prompt('Enter new name:', member.name);
    if (!newName || newName.trim() === '') return;

    const trimmedName = newName.trim();
    if (trimmedName === member.name) return;

    if (familyMembers.some(m => m.name === trimmedName && m.id !== id)) {
        alert('This family member name already exists');
        return;
    }

    member.name = trimmedName;

    saveData();
    renderFamilyMembers();
    renderBills();
    updateSummary();
}

// Edit family member email
function editMemberEmail(id) {
    const member = familyMembers.find(m => m.id === id);
    if (!member) return;

    const newEmail = prompt('Enter email address:', member.email);
    if (newEmail === null) return;

    member.email = newEmail.trim();

    saveData();
    renderFamilyMembers();
}

// Upload avatar
function uploadAvatar(id) {
    uploadImage((base64) => {
        const member = familyMembers.find(m => m.id === id);
        if (member) {
            member.avatar = base64;
            saveData();
            renderFamilyMembers();
        }
    });
}

// Remove avatar
function removeAvatar(id) {
    const member = familyMembers.find(m => m.id === id);
    if (member) {
        member.avatar = '';
        saveData();
        renderFamilyMembers();
    }
}

function manageLinkMembers(parentId) {
    const parent = familyMembers.find(m => m.id === parentId);
    if (!parent) return;

    // Include members already linked to THIS parent, plus unlinked non-parents
    const availableMembers = familyMembers.filter(m =>
        m.id !== parentId &&
        m.linkedMembers.length === 0 &&
        (!isLinkedToAnyone(m.id) || parent.linkedMembers.includes(m.id))
    );

    if (availableMembers.length === 0) {
        alert('No available members to link. Members can only be linked to one parent.');
        return;
    }

    let message = `Select members to link to ${parent.name}:\n\n`;
    message += 'Enter the numbers separated by commas (e.g., 1,3,4) or "0" to clear all links:\n\n';

    availableMembers.forEach((m, index) => {
        const isCurrentlyLinked = parent.linkedMembers.includes(m.id);
        message += `${index + 1}. ${m.name}${isCurrentlyLinked ? ' [LINKED]' : ''}\n`;
    });

    const input = prompt(message);
    if (input === null) return;

    if (input.trim() === '0') {
        parent.linkedMembers = [];
    } else {
        const selections = input.split(',').map(s => parseInt(s.trim()) - 1);
        parent.linkedMembers = selections
            .filter(i => i >= 0 && i < availableMembers.length)
            .map(i => availableMembers[i].id);
    }

    saveData();
    renderFamilyMembers();
    updateSummary();
}

// Check if a member is linked to anyone
function isLinkedToAnyone(memberId) {
    return familyMembers.some(m => m.linkedMembers.includes(memberId));
}

// Get parent of a member (if any)
function getParentMember(memberId) {
    return familyMembers.find(m => m.linkedMembers.includes(memberId));
}

// Remove family member
function removeFamilyMember(id) {
    const member = familyMembers.find(m => m.id === id);
    if (!member) return;

    if (!confirm(`Remove ${member.name} from family members? This will also remove them from all bills and unlink any linked members.`)) {
        return;
    }

    // Remove from other members' linked lists
    familyMembers.forEach(m => {
        m.linkedMembers = m.linkedMembers.filter(linkedId => linkedId !== id);
    });

    familyMembers = familyMembers.filter(m => m.id !== id);

    // Remove from all bills
    bills.forEach(bill => {
        bill.members = bill.members.filter(memberId => memberId !== id);
    });

    saveData();
    renderFamilyMembers();
    renderBills();
    updateSummary();
}

// Render family members
function renderFamilyMembers() {
    const container = document.getElementById('familyMembersList');

    if (familyMembers.length === 0) {
        container.innerHTML = '<p class="empty-state">No family members added yet</p>';
        return;
    }

    container.innerHTML = familyMembers.map(member => {
        const linkedNames = member.linkedMembers
            .map(id => {
                const linked = familyMembers.find(m => m.id === id);
                return linked ? escapeHtml(linked.name) : null;
            })
            .filter(name => name)
            .join(', ');

        return `
        <div class="member-card">
            <div class="member-avatar-container">
                ${generateAvatar(member)}
            </div>
            <div class="member-info">
                <div class="member-name" onclick="editFamilyMember(${member.id})" title="Click to edit name">${escapeHtml(member.name)}</div>
                <div class="member-email" onclick="editMemberEmail(${member.id})" title="Click to edit email">
                    ${escapeHtml(member.email) || 'No email'}
                </div>
                ${linkedNames ? `<div class="linked-members">Linked: ${linkedNames}</div>` : ''}
            </div>
            <div class="member-actions">
                <button class="btn-icon" onclick="uploadAvatar(${member.id})" title="Upload avatar">📷</button>
                ${member.avatar ? `<button class="btn-icon" onclick="removeAvatar(${member.id})" title="Remove avatar">🗑️</button>` : ''}
                <button class="btn-icon" onclick="manageLinkMembers(${member.id})" title="Link members">🔗</button>
                <button class="btn-icon remove" onclick="removeFamilyMember(${member.id})" title="Remove member">×</button>
            </div>
        </div>
    `}).join('');
}

// Add bill
function addBill() {
    const nameInput = document.getElementById('billName');
    const amountInput = document.getElementById('billAmount');
    const websiteInput = document.getElementById('billWebsite');

    const name = nameInput.value.trim();
    const amount = parseFloat(amountInput.value);
    const website = websiteInput.value.trim();

    if (!name) {
        alert('Please enter a bill name');
        return;
    }

    if (!amount || amount <= 0) {
        alert('Please enter a valid amount');
        return;
    }

    if (website && !/^https?:\/\//i.test(website)) {
        alert('Please enter a website URL starting with http:// or https://');
        return;
    }

    if (familyMembers.length === 0) {
        alert('Please add family members first');
        return;
    }

    const bill = {
        id: generateUniqueBillId(),
        name: name,
        amount: amount,
        logo: '',
        website: website,
        members: []
    };

    bills.push(bill);

    nameInput.value = '';
    amountInput.value = '';
    websiteInput.value = '';

    saveData();
    renderBills();
    updateSummary();

    // Analytics: Track bill added
    if (analytics) {
        analytics.logEvent('bill_added', {
            has_website: !!website,
            amount: amount,
            total_bills: bills.length
        });
    }
}

// Edit bill name
function editBillName(id) {
    const bill = bills.find(b => b.id === id);
    if (!bill) return;

    const newName = prompt('Enter new bill name:', bill.name);
    if (!newName || newName.trim() === '') return;

    bill.name = newName.trim();

    saveData();
    renderBills();
}

// Edit bill amount
function editBillAmount(id) {
    const bill = bills.find(b => b.id === id);
    if (!bill) return;

    const newAmount = prompt('Enter new monthly amount:', bill.amount);
    if (!newAmount || newAmount.trim() === '') return;

    const amount = parseFloat(newAmount);
    if (isNaN(amount) || amount <= 0) {
        alert('Please enter a valid amount');
        return;
    }

    bill.amount = amount;

    saveData();
    renderBills();
    updateSummary();
}

function editBillWebsite(id) {
    const bill = bills.find(b => b.id === id);
    if (!bill) return;

    const newWebsite = prompt('Enter website URL:', bill.website);
    if (newWebsite === null) return;

    const trimmed = newWebsite.trim();
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
        alert('Please enter a URL starting with http:// or https://');
        return;
    }

    bill.website = trimmed;

    saveData();
    renderBills();
}

// Upload logo
function uploadLogo(id) {
    uploadImage((base64) => {
        const bill = bills.find(b => b.id === id);
        if (bill) {
            bill.logo = base64;
            saveData();
            renderBills();
        }
    });
}

// Remove logo
function removeLogo(id) {
    const bill = bills.find(b => b.id === id);
    if (bill) {
        bill.logo = '';
        saveData();
        renderBills();
    }
}

// Remove bill
function removeBill(id) {
    if (!confirm('Remove this bill?')) return;

    bills = bills.filter(b => b.id !== id);

    saveData();
    renderBills();
    updateSummary();
}

// Toggle member for a bill
function toggleMember(billId, memberId) {
    const bill = bills.find(b => b.id === billId);
    if (!bill) return;

    const index = bill.members.indexOf(memberId);

    if (index === -1) {
        bill.members.push(memberId);
    } else {
        bill.members.splice(index, 1);
    }

    saveData();
    updateSummary();
}

// Render bills
function renderBills() {
    const container = document.getElementById('billsList');

    if (bills.length === 0) {
        container.innerHTML = '<p class="empty-state">No bills added yet</p>';
        return;
    }

    container.innerHTML = bills.map(bill => {
        const perPerson = bill.members.length > 0 ? (bill.amount / bill.members.length).toFixed(2) : '0.00';
        const safeWebsite = (bill.website && /^https?:\/\//i.test(bill.website)) ? escapeHtml(bill.website) : '';

        return `
            <div class="bill-item">
                <div class="bill-header-main">
                    <div class="bill-logo-container">
                        ${generateLogo(bill)}
                    </div>
                    <div class="bill-header">
                        <div>
                            <div class="bill-title editable" onclick="editBillName(${bill.id})" title="Click to edit name">${escapeHtml(bill.name)}</div>
                            ${safeWebsite ? `<div class="bill-website"><a href="${safeWebsite}" target="_blank" rel="noopener noreferrer">${safeWebsite}</a></div>` : ''}
                            <div style="color: #666; font-size: 0.9rem; margin-top: 5px;">
                                ${bill.members.length > 0 ? `$${perPerson} per person (${bill.members.length} members)` : 'No members selected'}
                            </div>
                        </div>
                        <div class="bill-amount editable" onclick="editBillAmount(${bill.id})" title="Click to edit amount">$${bill.amount.toFixed(2)}/mo</div>
                    </div>
                </div>

                <div class="bill-split-section">
                    <div class="split-header">Split with:</div>
                    <div class="member-checkboxes">
                        ${familyMembers.map(member => `
                            <div class="checkbox-item">
                                <input
                                    type="checkbox"
                                    id="bill-${bill.id}-${member.id}"
                                    ${bill.members.includes(member.id) ? 'checked' : ''}
                                    onchange="toggleMember(${bill.id}, ${member.id})"
                                />
                                <label for="bill-${bill.id}-${member.id}">${escapeHtml(member.name)}</label>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="bill-actions">
                    <button class="btn btn-secondary" onclick="uploadLogo(${bill.id})">Upload Logo</button>
                    ${bill.logo ? `<button class="btn btn-secondary" onclick="removeLogo(${bill.id})">Remove Logo</button>` : ''}
                    <button class="btn btn-secondary" onclick="editBillWebsite(${bill.id})">Edit Website</button>
                    <button class="btn btn-danger" onclick="removeBill(${bill.id})">Remove Bill</button>
                </div>
            </div>
        `;
    }).join('');
}

// Calculate annual summary
function calculateAnnualSummary() {
    const summary = {};

    // Initialize all family members with 0
    familyMembers.forEach(member => {
        summary[member.id] = {
            member: member,
            total: 0,
            bills: []
        };
    });

    // Calculate each member's share
    bills.forEach(bill => {
        if (bill.members.length > 0) {
            const monthlyPerPerson = bill.amount / bill.members.length;
            const annualPerPerson = monthlyPerPerson * 12;

            bill.members.forEach(memberId => {
                if (summary[memberId]) {
                    summary[memberId].total += annualPerPerson;
                    summary[memberId].bills.push({
                        bill: bill,
                        monthlyShare: monthlyPerPerson,
                        annualShare: annualPerPerson
                    });
                }
            });
        }
    });

    return summary;
}

// Update summary display
function updateSummary() {
    const container = document.getElementById('annualSummary');
    const summary = calculateAnnualSummary();

    if (familyMembers.length === 0) {
        container.innerHTML = '<p class="empty-state">Add family members and bills to see the summary</p>';
        return;
    }

    let totalAnnual = 0;
    Object.values(summary).forEach(data => {
        totalAnnual += data.total;
    });

    let totalPayments = 0;

    // Only show parent members and independent members in main rows
    const mainMembers = familyMembers.filter(m => !isLinkedToAnyone(m.id));

    const tableRows = mainMembers
        .map(member => {
            const data = summary[member.id];
            if (!data) return '';

            // Calculate combined total for parent and linked members
            let combinedTotal = data.total;
            const linkedData = [];

            member.linkedMembers.forEach(linkedId => {
                const linkedSummary = summary[linkedId];
                if (linkedSummary) {
                    combinedTotal += linkedSummary.total;
                    linkedData.push(linkedSummary);
                }
            });

            const payment = member.paymentReceived || 0;

            // Calculate actual payments for parent and children
            let actualParentPayment = payment;
            let totalChildPayments = 0;

            member.linkedMembers.forEach(linkedId => {
                const linkedMember = familyMembers.find(m => m.id === linkedId);
                if (linkedMember) {
                    const childPayment = linkedMember.paymentReceived || 0;
                    totalChildPayments += childPayment;
                }
            });

            // Parent's actual payment is the total minus what was distributed to children
            actualParentPayment = payment - totalChildPayments;

            // Combined balance for display
            const balance = combinedTotal - payment;
            totalPayments += payment;

            let rows = `
            <tr class="parent-row">
                <td>
                    <div class="summary-member">
                        ${generateAvatar(data.member)}
                        <span>${escapeHtml(data.member.name)}</span>
                        ${member.linkedMembers.length > 0 ? `<span class="member-count">(+${member.linkedMembers.length})</span>` : ''}
                    </div>
                </td>
                <td>$${(combinedTotal / 12).toFixed(2)}</td>
                <td><strong>$${combinedTotal.toFixed(2)}</strong></td>
                <td>
                    <input
                        type="number"
                        class="payment-input"
                        value="${payment}"
                        step="0.01"
                        min="0"
                        onchange="updatePayment(${data.member.id}, this.value)"
                        placeholder="0.00"
                    />
                </td>
                <td class="${balance > 0 ? 'balance-owed' : 'balance-paid'}">
                    <strong>$${balance.toFixed(2)}</strong>
                </td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="sendIndividualInvoice(${data.member.id})">
                        Email Invoice
                    </button>
                </td>
            </tr>
            `;

            // Add child rows
            linkedData.forEach(linkedSummary => {
                const childPayment = linkedSummary.member.paymentReceived || 0;
                const childBalance = linkedSummary.total - childPayment;
                rows += `
                <tr class="child-row">
                    <td>
                        <div class="summary-member summary-child">
                            <span class="child-indicator">↳</span>
                            ${generateAvatar(linkedSummary.member)}
                            <span>${escapeHtml(linkedSummary.member.name)}</span>
                        </div>
                    </td>
                    <td>$${(linkedSummary.total / 12).toFixed(2)}</td>
                    <td>$${linkedSummary.total.toFixed(2)}</td>
                    <td>$${childPayment.toFixed(2)}</td>
                    <td class="${childBalance > 0 ? 'balance-owed' : 'balance-paid'}">
                        $${childBalance.toFixed(2)}
                    </td>
                    <td></td>
                </tr>
                `;
            });

            return rows;
        })
        .join('');

    const totalBalance = totalAnnual - totalPayments;

    container.innerHTML = `
        <table class="summary-table">
            <thead>
                <tr>
                    <th>Family Member</th>
                    <th>Monthly Total</th>
                    <th>Annual Total</th>
                    <th>Payment Received</th>
                    <th>Balance</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${tableRows}
                <tr class="total-row">
                    <td>TOTAL</td>
                    <td>$${(totalAnnual / 12).toFixed(2)}</td>
                    <td><strong>$${totalAnnual.toFixed(2)}</strong></td>
                    <td><strong>$${totalPayments.toFixed(2)}</strong></td>
                    <td colspan="2"><strong>$${totalBalance.toFixed(2)}</strong></td>
                </tr>
            </tbody>
        </table>
    `;
}

// Update payment received for a member
function updatePayment(memberId, value) {
    const member = familyMembers.find(m => m.id === memberId);
    if (!member) return;

    const payment = Math.max(0, parseFloat(value) || 0);
    member.paymentReceived = payment;

    // If this member has linked members, distribute the payment proportionally
    if (member.linkedMembers && member.linkedMembers.length > 0) {
        // Calculate total owed by parent + all linked members
        const summary = calculateAnnualSummary();
        let combinedTotal = summary[member.id] ? summary[member.id].total : 0;

        // Add linked members' totals
        member.linkedMembers.forEach(linkedId => {
            if (summary[linkedId]) {
                combinedTotal += summary[linkedId].total;
            }
        });

        // Distribute payment proportionally based on what each person owes
        const parentTotal = summary[member.id] ? summary[member.id].total : 0;
        const parentPayment = combinedTotal > 0 ? (payment * parentTotal / combinedTotal) : 0;

        // Parent keeps their proportional share
        member.paymentReceived = payment; // Store full payment on parent

        // Update each linked member's payment proportionally
        member.linkedMembers.forEach(linkedId => {
            const linkedMember = familyMembers.find(m => m.id === linkedId);
            if (linkedMember && summary[linkedId]) {
                const linkedTotal = summary[linkedId].total;
                const linkedPayment = combinedTotal > 0 ? (payment * linkedTotal / combinedTotal) : 0;
                linkedMember.paymentReceived = linkedPayment;
            }
        });
    }

    saveData();
    updateSummary();
}

// Render email settings
function renderEmailSettings() {
    const container = document.getElementById('emailSettings');
    container.innerHTML = `
        <div class="form-group">
            <label for="emailMessage">Email Message (sent with all invoices)</label>
            <p style="color: #666; font-size: 0.9rem; margin-bottom: 8px;">
                Use <strong>%total</strong> to insert the combined annual total (e.g., "payment of %total")
            </p>
            <textarea id="emailMessageInput" rows="4">${escapeHtml(settings.emailMessage)}</textarea>
            <button class="btn btn-primary" onclick="saveEmailMessage()" style="margin-top: 10px;">Save Message</button>
        </div>
    `;
}

// Save email message
function saveEmailMessage() {
    const input = document.getElementById('emailMessageInput');
    settings.emailMessage = input.value;
    saveData();
    alert('Email message saved!');
}

// Force data repair
function forceDataRepair() {
    console.log('=== FORCING DATA REPAIR ===');

    // Repair duplicate IDs
    repairDuplicateIds();

    // Clean up invalid members
    cleanupInvalidBillMembers();

    // Re-render everything
    renderFamilyMembers();
    renderBills();
    updateSummary();

    // Debug check
    debugDataIntegrity();

    alert('Data repair complete! Check the browser console for details.');
}

// Import data from LocalStorage
async function importFromLocalStorage() {
    try {
        // Check if LocalStorage has data
        const localFamilyMembers = localStorage.getItem('familyMembers');
        const localBills = localStorage.getItem('bills');
        const localSettings = localStorage.getItem('settings');

        if (!localFamilyMembers && !localBills) {
            alert('No data found in LocalStorage to import.');
            return;
        }

        if (!confirm('This will import your LocalStorage data and REPLACE your current Firebase data. Continue?')) {
            return;
        }

        // Parse LocalStorage data
        const importedMembers = localFamilyMembers ? JSON.parse(localFamilyMembers) : [];
        const importedBills = localBills ? JSON.parse(localBills) : [];
        const importedSettings = localSettings ? JSON.parse(localSettings) : settings;

        console.log('Importing from LocalStorage:');
        console.log('- Family Members:', importedMembers.length);
        console.log('- Bills:', importedBills.length);

        // Replace current data with imported data
        familyMembers = importedMembers.map(m => {
            if (!m.email) m.email = '';
            if (!m.avatar) m.avatar = '';
            if (m.paymentReceived === undefined) m.paymentReceived = 0;
            if (!m.linkedMembers) m.linkedMembers = [];
            return m;
        });

        bills = importedBills.map(b => {
            if (!b.logo) b.logo = '';
            if (!b.website) b.website = '';
            if (!b.members) b.members = [];
            return b;
        });

        if (importedSettings) {
            settings = importedSettings;
        }

        // Save to Firebase
        await saveData();

        // Re-render everything
        renderFamilyMembers();
        renderBills();
        updateSummary();
        renderEmailSettings();

        alert(`Import successful!\n\nImported:\n- ${importedMembers.length} family members\n- ${importedBills.length} bills\n\nData has been saved to Firebase.`);

    } catch (error) {
        console.error('Import error:', error);
        alert('Error importing data. Please check the browser console for details.');
    }
}

async function clearAllData() {
    if (!confirm('Are you sure you want to clear ALL data? This cannot be undone!')) {
        return;
    }

    if (!confirm('This will delete all family members, bills, and settings. Are you ABSOLUTELY sure?')) {
        return;
    }

    familyMembers = [];
    bills = [];
    settings = {
        emailMessage: 'I have attached your annual bill summary. Thank you for your prompt payment of %total via any of the payment services below.'
    };

    await saveData();

    renderFamilyMembers();
    renderBills();
    updateSummary();
    renderEmailSettings();

    alert('All data has been cleared.');
}

// Generate printable invoice (full)
function generateInvoice() {
    const summary = calculateAnnualSummary();

    if (familyMembers.length === 0 || bills.length === 0) {
        alert('Please add family members and bills first');
        return;
    }

    const currentYear = new Date().getFullYear();
    const invoiceHTML = generateInvoiceHTML(summary, currentYear);

    // Open in new window
    const invoiceWindow = window.open('', '_blank');
    invoiceWindow.document.write(invoiceHTML);
    invoiceWindow.document.close();
}

// Send individual invoice via email (plain text)
function sendIndividualInvoice(memberId) {
    const member = familyMembers.find(m => m.id === memberId);
    if (!member) return;

    if (!member.email) {
        alert(`${member.name} does not have an email address set. Please add one first.`);
        return;
    }

    const summary = calculateAnnualSummary();
    const memberData = summary[memberId];

    // Get linked members data
    const linkedMembersData = member.linkedMembers.map(linkedId => summary[linkedId]).filter(d => d);

    // Calculate combined total
    let combinedTotal = memberData ? memberData.total : 0;
    linkedMembersData.forEach(data => {
        combinedTotal += data.total;
    });

    if (combinedTotal === 0) {
        alert(`${member.name} has no bills to invoice.`);
        return;
    }

    const currentYear = new Date().getFullYear();
    const firstName = member.name.split(' ')[0];
    const numMembers = 1 + member.linkedMembers.length;
    const payment = member.paymentReceived || 0;
    const paymentPerPerson = payment / numMembers;

    // Generate plain text invoice with %total placeholder replacement
    const emailMessage = settings.emailMessage.replace(/%total/g, `$${combinedTotal.toFixed(2)}`);
    let invoiceText = `Hello ${firstName},\n\n${emailMessage}\n\n`;
    invoiceText += `======================================\n`;
    invoiceText += `ANNUAL BILL INVOICE - ${currentYear}\n`;
    invoiceText += `======================================\n\n`;
    invoiceText += `Primary: ${member.name}\n`;

    if (linkedMembersData.length > 0) {
        invoiceText += `Linked Members: ${linkedMembersData.map(d => d.member.name).join(', ')}\n`;
    }
    invoiceText += `Invoice Date: ${new Date().toLocaleDateString()}\n\n`;

    // Bill breakdown for primary member
    if (memberData && memberData.bills.length > 0) {
        invoiceText += `${member.name.toUpperCase()}'S BILLS:\n`;
        invoiceText += `${'='.repeat(80)}\n`;
        invoiceText += `${'Bill'.padEnd(25)} ${'Monthly'.padEnd(12)} ${'Split'.padEnd(8)} ${'Your Share'.padEnd(12)} ${'Annual'}\n`;
        invoiceText += `${'-'.repeat(80)}\n`;

        let monthlyTotal = 0;
        memberData.bills.forEach(billData => {
            const billName = billData.bill.name.padEnd(25).substring(0, 25);
            const monthlyAmount = `$${billData.bill.amount.toFixed(2)}`.padEnd(12);
            const splitWith = `${billData.bill.members.length} ppl`.padEnd(8);
            const yourShare = `$${billData.monthlyShare.toFixed(2)}`.padEnd(12);
            const annual = `$${billData.annualShare.toFixed(2)}`;

            invoiceText += `${billName} ${monthlyAmount} ${splitWith} ${yourShare} ${annual}\n`;
            monthlyTotal += billData.monthlyShare;
        });

        invoiceText += `${'-'.repeat(80)}\n`;
        invoiceText += `SUBTOTAL: $${monthlyTotal.toFixed(2)}/mo = $${memberData.total.toFixed(2)}/year\n`;
        invoiceText += `${'='.repeat(80)}\n\n`;
    }

    // Bill breakdown for each linked member
    linkedMembersData.forEach(linkedData => {
        if (linkedData.bills.length > 0) {
            invoiceText += `${linkedData.member.name.toUpperCase()}'S BILLS:\n`;
            invoiceText += `${'='.repeat(80)}\n`;
            invoiceText += `${'Bill'.padEnd(25)} ${'Monthly'.padEnd(12)} ${'Split'.padEnd(8)} ${'Their Share'.padEnd(12)} ${'Annual'}\n`;
            invoiceText += `${'-'.repeat(80)}\n`;

            let monthlyTotal = 0;
            linkedData.bills.forEach(billData => {
                const billName = billData.bill.name.padEnd(25).substring(0, 25);
                const monthlyAmount = `$${billData.bill.amount.toFixed(2)}`.padEnd(12);
                const splitWith = `${billData.bill.members.length} ppl`.padEnd(8);
                const theirShare = `$${billData.monthlyShare.toFixed(2)}`.padEnd(12);
                const annual = `$${billData.annualShare.toFixed(2)}`;

                invoiceText += `${billName} ${monthlyAmount} ${splitWith} ${theirShare} ${annual}\n`;
                monthlyTotal += billData.monthlyShare;
            });

            invoiceText += `${'-'.repeat(80)}\n`;
            invoiceText += `SUBTOTAL: $${monthlyTotal.toFixed(2)}/mo = $${linkedData.total.toFixed(2)}/year\n`;
            invoiceText += `${'='.repeat(80)}\n\n`;
        }
    });

    // Combined payment summary
    const balance = combinedTotal - payment;

    invoiceText += `PAYMENT SUMMARY:\n`;
    invoiceText += `${'='.repeat(80)}\n`;
    invoiceText += `  Combined Annual Total:         $${combinedTotal.toFixed(2)}\n`;
    if (payment > 0) {
        invoiceText += `  Payment Received:              $${payment.toFixed(2)}\n`;
        invoiceText += `  Payment Per Person (${numMembers} members):   $${paymentPerPerson.toFixed(2)}\n`;
        invoiceText += `  Balance Remaining:             $${balance.toFixed(2)}\n`;
    } else {
        invoiceText += `  Payment Received:              $0.00\n`;
        invoiceText += `  Balance Remaining:             $${balance.toFixed(2)}\n`;
    }
    invoiceText += `${'='.repeat(80)}\n`;

    invoiceText += `\n\nThank you for your prompt payment!\n`;

    // Create mailto link with plain text invoice
    const subject = `Annual Bill Invoice ${currentYear}`;
    const mailtoLink = `mailto:${member.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(invoiceText)}`;

    // Open email client
    window.location.href = mailtoLink;

    // Analytics: Track invoice sent
    if (analytics) {
        analytics.logEvent('invoice_sent', {
            has_linked_members: linkedMembersData.length > 0,
            num_linked_members: linkedMembersData.length,
            total_amount: combinedTotal,
            has_payment: payment > 0
        });
    }
}

function generateInvoiceHTML(summary, currentYear) {
    let totalAnnual = 0;
    Object.values(summary).forEach(data => {
        totalAnnual += data.total;
    });

    let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Annual Bill Invoice - ${currentYear}</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    max-width: 800px;
                    margin: 40px auto;
                    padding: 20px;
                }
                h1 {
                    color: #333;
                    border-bottom: 3px solid #667eea;
                    padding-bottom: 10px;
                }
                h2 {
                    color: #555;
                    margin-top: 30px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 20px 0;
                }
                th, td {
                    padding: 12px;
                    text-align: left;
                    border-bottom: 1px solid #ddd;
                }
                th {
                    background: #f7fafc;
                    font-weight: bold;
                }
                .total-row {
                    font-weight: bold;
                    background: #f0f0f0;
                    font-size: 1.1em;
                }
                .member-section {
                    page-break-inside: avoid;
                    margin-bottom: 40px;
                }
                .avatar {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    object-fit: cover;
                    vertical-align: middle;
                    margin-right: 8px;
                }
                .avatar-initials {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    background: #667eea;
                    color: white;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 14px;
                    font-weight: bold;
                    vertical-align: middle;
                    margin-right: 8px;
                }
                .logo {
                    width: 40px;
                    height: 30px;
                    object-fit: contain;
                    vertical-align: middle;
                    margin-right: 8px;
                }
                .logo-text {
                    display: inline-block;
                    padding: 4px 8px;
                    background: #f0f0f0;
                    border-radius: 4px;
                    font-size: 12px;
                    font-weight: bold;
                    color: #333;
                    vertical-align: middle;
                    margin-right: 8px;
                }
                @media print {
                    .no-print {
                        display: none;
                    }
                }
            </style>
        </head>
        <body>
            <h1>Annual Bill Invoice - ${currentYear}</h1>
            <p>Generated on: ${new Date().toLocaleDateString()}</p>

            <button class="no-print" onclick="window.print()" style="padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 20px 0;">Print Invoice</button>

            <h2>Summary</h2>
            <table>
                <thead>
                    <tr>
                        <th>Family Member</th>
                        <th>Monthly Total</th>
                        <th>Annual Total</th>
                    </tr>
                </thead>
                <tbody>
    `;

    Object.values(summary).forEach(data => {
        const safeName = escapeHtml(data.member.name);
        const safeAvatarSrc = sanitizeImageSrc(data.member.avatar);
        const avatarHTML = safeAvatarSrc
            ? `<img src="${safeAvatarSrc}" class="avatar" alt="${safeName}" />`
            : `<div class="avatar-initials">${escapeHtml(getInitials(data.member.name))}</div>`;

        html += `
                    <tr>
                        <td>${avatarHTML}${safeName}</td>
                        <td>$${(data.total / 12).toFixed(2)}</td>
                        <td><strong>$${data.total.toFixed(2)}</strong></td>
                    </tr>
        `;
    });

    html += `
                    <tr class="total-row">
                        <td>TOTAL</td>
                        <td>$${(totalAnnual / 12).toFixed(2)}</td>
                        <td><strong>$${totalAnnual.toFixed(2)}</strong></td>
                    </tr>
                </tbody>
            </table>
    `;

    Object.values(summary).forEach(data => {
        if (data.total === 0) return;

        const safeName = escapeHtml(data.member.name);
        const safeAvatarSrc = sanitizeImageSrc(data.member.avatar);
        const avatarHTML = safeAvatarSrc
            ? `<img src="${safeAvatarSrc}" class="avatar" alt="${safeName}" />`
            : `<div class="avatar-initials">${escapeHtml(getInitials(data.member.name))}</div>`;

        html += `
            <div class="member-section">
                <h2>${avatarHTML}${safeName}'s Bill Breakdown</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Bill</th>
                            <th>Monthly Amount</th>
                            <th>Split With</th>
                            <th>Your Monthly Share</th>
                            <th>Annual Total</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        data.bills.forEach(billData => {
            const safeBillName = escapeHtml(billData.bill.name);
            const safeLogoSrc = sanitizeImageSrc(billData.bill.logo);
            const logoHTML = safeLogoSrc
                ? `<img src="${safeLogoSrc}" class="logo" alt="${safeBillName}" />`
                : `<div class="logo-text">${safeBillName}</div>`;

            html += `
                        <tr>
                            <td>${logoHTML}${safeBillName}</td>
                            <td>$${billData.bill.amount.toFixed(2)}</td>
                            <td>${billData.bill.members.length} members</td>
                            <td>$${billData.monthlyShare.toFixed(2)}</td>
                            <td>$${billData.annualShare.toFixed(2)}</td>
                        </tr>
            `;
        });

        html += `
                        <tr class="total-row">
                            <td colspan="3">TOTAL</td>
                            <td>$${(data.total / 12).toFixed(2)}</td>
                            <td><strong>$${data.total.toFixed(2)}</strong></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    });

    html += `
        </body>
        </html>
    `;

    return html;
}

