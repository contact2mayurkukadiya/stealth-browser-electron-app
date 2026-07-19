import { DOM, hideAll } from '../state.js';
import { notifyHost } from '../api.js';
import { AssetMaskIcon, getCompactMenuMetrics, toCompactMenuPoint } from '../utils/dom.js';

export function renderSiteInfo(payload) {
    hideAll({ hideLens: false });
    const r = payload.anchorRect || {};
    const width = 340;
    const metrics = getCompactMenuMetrics(payload);
    const pad = 8;
    const left0 = Math.round(r.left != null ? r.left : 0);
    const top0 = Math.round(r.top != null ? r.top : 0);
    const h0 = Math.max(1, Math.round(r.height != null ? r.height : 32));
    const left = Math.max(pad, Math.min(left0, metrics.viewportWidth - width - pad));
    const top = Math.max(pad, Math.min(top0 + h0 + 6, metrics.viewportHeight - 280 - pad));
    const panelPoint = toCompactMenuPoint(payload, left, top);
    DOM.panel.innerHTML = '';
    DOM.panel.style.left = panelPoint.left + 'px';
    DOM.panel.style.top = panelPoint.top + 'px';
    DOM.panel.style.width = width + 'px';
    DOM.panel.style.minWidth = width + 'px';
    DOM.panel.style.maxWidth = width + 'px';
    DOM.panel.style.maxHeight = Math.max(240, Math.min(metrics.viewportHeight * 0.6, metrics.viewportHeight - top - pad)) + 'px';
    DOM.panel.style.display = '';
    DOM.panel.style.flexDirection = '';
    DOM.panel.style.overflowY = 'auto';
    DOM.panel.style.overflowX = 'hidden';
    DOM.panel.classList.remove('co-panel--app-menu');

    const domain = payload.domain || '';
    const isSecure = payload.isSecure !== false;

    function showMainView() {
        DOM.panel.innerHTML = '';
        const header = document.createElement('div');
        header.className = 'co-site-info-header';
        const title = document.createElement('span');
        title.className = 'co-site-info-domain';
        title.textContent = domain;
        const closeBtn = document.createElement('button');
        closeBtn.className = 'co-site-info-close-btn';
        closeBtn.appendChild(AssetMaskIcon('assets/images/cross-small.svg', 16));
        closeBtn.onclick = function () { hideAll({ hideLens: false }); };
        header.appendChild(title);
        header.appendChild(closeBtn);
        DOM.panel.appendChild(header);

        const content = document.createElement('div');
        content.className = 'co-site-info-content';
        const createRow = function (iconSvg, text, actionSvg, isTall, subtext, onClick) {
            const btn = document.createElement('button');
            btn.className = 'co-site-info-row' + (isTall ? ' co-site-info-row-tall' : '');
            if (onClick) btn.onclick = onClick;
            const iconDiv = document.createElement('div');
            iconDiv.className = 'co-site-info-icon';
            iconDiv.appendChild(AssetMaskIcon(iconSvg, 16));
            btn.appendChild(iconDiv);
            if (subtext) {
                const textGroup = document.createElement('div');
                textGroup.className = 'co-site-info-text-group';
                const mainText = document.createElement('div');
                mainText.className = 'co-site-info-text';
                mainText.textContent = text;
                const subTextDiv = document.createElement('div');
                subTextDiv.className = 'co-site-info-subtext';
                subTextDiv.textContent = subtext;
                textGroup.appendChild(mainText);
                textGroup.appendChild(subTextDiv);
                btn.appendChild(textGroup);
            } else {
                const textDiv = document.createElement('div');
                textDiv.className = 'co-site-info-text';
                textDiv.textContent = text;
                btn.appendChild(textDiv);
            }
            const actionDiv = document.createElement('div');
            actionDiv.className = 'co-site-info-action';
            actionDiv.appendChild(AssetMaskIcon(actionSvg, 16));
            btn.appendChild(actionDiv);
            return btn;
        };

        const chevronSvg = 'assets/images/angle-right.svg';
        const externalSvg = 'assets/images/external-link.svg';
        const lockIconHtml = isSecure ? 'assets/images/lock.svg' : 'assets/images/unlock.svg';
        const cookieIconHtml = 'assets/images/cookie.svg';
        const settingsIconHtml = 'assets/images/settings.svg';
        const commentInfoIconHtml = 'assets/images/comment-info.svg';

        content.appendChild(createRow(lockIconHtml, isSecure ? 'Connection is secure' : 'Connection is not secure', chevronSvg, false, null, function () {
            showSecurityView();
        }));
        content.appendChild(createRow(cookieIconHtml, 'Cookies and site data', chevronSvg, false, null, function () {
            showCookiesView();
        }));
        content.appendChild(createRow(settingsIconHtml, 'Site settings', externalSvg, false));
        const divider = document.createElement('div');
        divider.className = 'co-site-info-divider';
        content.appendChild(divider);
        content.appendChild(createRow(commentInfoIconHtml, 'About this page', externalSvg, true, 'Learn about its source and topic'));
        DOM.panel.appendChild(content);
    }

    function showSecurityView() {
        DOM.panel.innerHTML = '';
        const header = document.createElement('div');
        header.className = 'co-site-info-header co-site-info-header--sub';
        const backBtn = document.createElement('button');
        backBtn.className = 'co-site-info-icon-btn';
        backBtn.appendChild(AssetMaskIcon('assets/images/arrow-left.svg', 20));
        backBtn.onclick = showMainView;
        const titleGroup = document.createElement('div');
        titleGroup.className = 'co-site-info-title-group';
        const title = document.createElement('div');
        title.className = 'co-site-info-title';
        title.textContent = 'Security';
        const subtitle = document.createElement('div');
        subtitle.className = 'co-site-info-subtitle';
        subtitle.textContent = domain;
        titleGroup.appendChild(title);
        titleGroup.appendChild(subtitle);
        const closeBtn = document.createElement('button');
        closeBtn.className = 'co-site-info-icon-btn';
        closeBtn.appendChild(AssetMaskIcon('assets/images/cross-small.svg', 16));
        closeBtn.onclick = function () { hideAll({ hideLens: false }); };
        header.appendChild(backBtn);
        header.appendChild(titleGroup);
        header.appendChild(closeBtn);
        DOM.panel.appendChild(header);

        const divider1 = document.createElement('div');
        divider1.className = 'co-site-info-divider';
        DOM.panel.appendChild(divider1);
        const body = document.createElement('div');
        body.className = 'co-site-info-security-body';
        const iconDiv = document.createElement('div');
        iconDiv.className = 'co-site-info-icon';
        iconDiv.appendChild(AssetMaskIcon(isSecure ? 'assets/images/lock.svg' : 'assets/images/unlock.svg', 16));
        const textDiv = document.createElement('div');
        textDiv.className = 'co-site-info-security-text';
        const heading = document.createElement('div');
        heading.className = 'co-site-info-security-heading';
        heading.textContent = isSecure ? 'Connection is secure' : 'Connection is not secure';
        const desc = document.createElement('div');
        desc.className = 'co-site-info-security-desc';
        desc.innerHTML = isSecure
            ? 'Your information (for example, passwords or credit card numbers) is private when it is sent to this site. <a href="#" class="co-site-info-link">Learn more</a>'
            : 'You should not enter any sensitive information on this site (for example, passwords or credit cards), because it could be stolen by attackers. <a href="#" class="co-site-info-link">Learn more</a>';
        textDiv.appendChild(heading);
        textDiv.appendChild(desc);
        body.appendChild(iconDiv);
        body.appendChild(textDiv);
        DOM.panel.appendChild(body);

        const divider2 = document.createElement('div');
        divider2.className = 'co-site-info-divider';
        DOM.panel.appendChild(divider2);
        const certRow = document.createElement('button');
        certRow.className = 'co-site-info-row';
        const certIcon = document.createElement('div');
        certIcon.className = 'co-site-info-icon';
        certIcon.appendChild(AssetMaskIcon('assets/images/diploma.svg', 16));
        const certText = document.createElement('div');
        certText.className = 'co-site-info-text';
        certText.textContent = 'Certificate is valid';
        const certAction = document.createElement('div');
        certAction.className = 'co-site-info-action';
        certAction.appendChild(AssetMaskIcon('assets/images/external-link.svg', 16));
        certRow.appendChild(certIcon);
        certRow.appendChild(certText);
        certRow.appendChild(certAction);
        DOM.panel.appendChild(certRow);
    }

    async function showCookiesView() {
        DOM.panel.innerHTML = '';
        const header = document.createElement('div');
        header.className = 'co-site-info-header co-site-info-header--sub';
        const backBtn = document.createElement('button');
        backBtn.className = 'co-site-info-icon-btn';
        backBtn.appendChild(AssetMaskIcon('assets/images/arrow-left.svg', 20));
        backBtn.onclick = showMainView;
        const titleGroup = document.createElement('div');
        titleGroup.className = 'co-site-info-title-group';
        const title = document.createElement('span');
        title.className = 'co-site-info-title';
        title.textContent = 'Cookies and site data';
        const subtitle = document.createElement('span');
        subtitle.className = 'co-site-info-subtitle';
        subtitle.textContent = domain;
        titleGroup.appendChild(title);
        titleGroup.appendChild(subtitle);
        const closeBtn = document.createElement('button');
        closeBtn.className = 'co-site-info-close-btn';
        closeBtn.appendChild(AssetMaskIcon('assets/images/cross-small.svg', 16));
        closeBtn.onclick = function () { hideAll({ hideLens: false }); };
        header.appendChild(backBtn);
        header.appendChild(titleGroup);
        header.appendChild(closeBtn);
        DOM.panel.appendChild(header);

        const divider1 = document.createElement('div');
        divider1.className = 'co-site-info-divider';
        DOM.panel.appendChild(divider1);
        const body = document.createElement('div');
        body.className = 'co-site-info-security-body';
        const iconDiv = document.createElement('div');
        iconDiv.className = 'co-site-info-icon';
        iconDiv.appendChild(AssetMaskIcon('assets/images/cookie.svg', 16));
        const textDiv = document.createElement('div');
        textDiv.className = 'co-site-info-security-text';
        const heading = document.createElement('div');
        heading.className = 'co-site-info-security-heading';
        heading.textContent = 'On-device site data';
        const desc = document.createElement('div');
        desc.className = 'co-site-info-security-desc';
        desc.innerHTML = 'Data saved on your device can be used to keep you signed in, to remember your preferences, or for other purposes. <a href="#" class="co-site-info-link">Learn more</a>';
        textDiv.appendChild(heading);
        textDiv.appendChild(desc);
        body.appendChild(iconDiv);
        body.appendChild(textDiv);
        DOM.panel.appendChild(body);

        const divider2 = document.createElement('div');
        divider2.className = 'co-site-info-divider';
        DOM.panel.appendChild(divider2);
        const manageRow = document.createElement('button');
        manageRow.className = 'co-site-info-row';
        manageRow.onclick = showManageDataView;
        const manageIcon = document.createElement('div');
        manageIcon.className = 'co-site-info-icon';
        manageIcon.appendChild(AssetMaskIcon('assets/images/database-management.svg', 16));
        const manageText = document.createElement('div');
        manageText.className = 'co-site-info-text';
        manageText.textContent = 'Manage on-device site data';
        const manageAction = document.createElement('div');
        manageAction.className = 'co-site-info-action';
        manageAction.appendChild(AssetMaskIcon('assets/images/angle-right.svg', 16));
        manageRow.appendChild(manageIcon);
        manageRow.appendChild(manageText);
        manageRow.appendChild(manageAction);
        DOM.panel.appendChild(manageRow);
    }

    async function showManageDataView() {
        DOM.panel.innerHTML = '';
        DOM.panel.style.display = 'flex';
        DOM.panel.style.flexDirection = 'column';
        DOM.panel.style.overflowY = 'hidden';

        const header = document.createElement('div');
        header.style.padding = '16px 16px 8px';
        header.style.flexShrink = '0';
        const title = document.createElement('div');
        title.style.fontSize = '15px';
        title.style.fontWeight = '500';
        title.style.color = '#202124';
        title.style.marginBottom = '8px';
        title.textContent = 'On-device site data';
        const subtitle = document.createElement('div');
        subtitle.style.fontSize = '13px';
        subtitle.style.color = '#5f6368';
        subtitle.style.lineHeight = '1.4';
        subtitle.innerHTML = 'To improve your visit, sites often save your activity \u2013 often to your device. <a href="#" class="co-site-info-link">Manage site data</a>';
        header.appendChild(title);
        header.appendChild(subtitle);
        DOM.panel.appendChild(header);

        const scrollArea = document.createElement('div');
        scrollArea.style.flex = '1';
        scrollArea.style.overflowY = 'auto';
        scrollArea.style.overflowX = 'hidden';
        DOM.panel.appendChild(scrollArea);

        const loading = document.createElement('div');
        loading.className = 'co-site-info-loading';
        loading.textContent = 'Loading...';
        loading.style.padding = '16px';
        loading.style.color = '#5f6368';
        loading.style.fontSize = '13px';
        scrollArea.appendChild(loading);

        const footer = document.createElement('div');
        footer.style.padding = '12px 16px';
        footer.style.display = 'flex';
        footer.style.justifyContent = 'flex-end';
        footer.style.borderTop = '1px solid var(--chrome-tab-separator, #dadce0)';
        footer.style.flexShrink = '0';
        footer.style.backgroundColor = 'var(--chrome-nav-bg, #ffffff)';
        footer.style.borderBottomLeftRadius = '8px';
        footer.style.borderBottomRightRadius = '8px';
        const doneBtn = document.createElement('button');
        doneBtn.textContent = 'Done';
        doneBtn.style.padding = '6px 16px';
        doneBtn.style.background = '#f1f3f4';
        doneBtn.style.border = 'none';
        doneBtn.style.borderRadius = '16px';
        doneBtn.style.color = '#202124';
        doneBtn.style.fontSize = '13px';
        doneBtn.style.fontWeight = '500';
        doneBtn.style.cursor = 'pointer';
        doneBtn.onmouseenter = () => doneBtn.style.backgroundColor = '#e8eaed';
        doneBtn.onmouseleave = () => doneBtn.style.backgroundColor = '#f1f3f4';
        doneBtn.onclick = () => notifyHost({ type: 'dismiss' });
        footer.appendChild(doneBtn);
        DOM.panel.appendChild(footer);

        try {
            const usage = await window.electronAPI.webauthnGetCookieUsage();
            scrollArea.removeChild(loading);

            const createDomainRow = (domainData, isMain) => {
                const row = document.createElement('div');
                row.className = 'co-site-info-domain-row';
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.padding = '8px 16px';
                row.style.fontSize = '13px';
                const icon = document.createElement('div');
                icon.style.marginRight = '12px';
                icon.style.display = 'flex';
                icon.style.alignItems = 'center';
                icon.style.color = '#5f6368';
                if (isMain && payload.favicon) {
                    icon.innerHTML = `<img src="${payload.favicon}" width="16" height="16" alt="" style="border-radius: 2px;" />`;
                } else {
                    icon.appendChild(AssetMaskIcon('assets/images/earth-americas.svg', 16));
                }
                const name = document.createElement('div');
                name.style.flex = '1';
                name.style.color = '#202124';
                name.textContent = domainData.domain;
                const actions = document.createElement('div');
                actions.style.display = 'flex';
                actions.style.alignItems = 'center';
                actions.style.gap = '16px';

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'co-site-info-icon-btn';
                deleteBtn.appendChild(AssetMaskIcon('assets/images/trash.svg', 16));
                deleteBtn.onclick = async () => {
                    await window.electronAPI.webauthnDeleteCookies(domainData.domain);
                    showManageDataView();
                };

                const menuBtn = document.createElement('button');
                menuBtn.className = 'co-site-info-icon-btn';
                menuBtn.appendChild(AssetMaskIcon('assets/images/menu-dots-vertical.svg', 16));
                menuBtn.onclick = (e) => {
                    const menu = document.createElement('div');
                    menu.style.position = 'absolute';
                    menu.style.right = '16px';
                    menu.style.backgroundColor = 'white';
                    menu.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
                    menu.style.borderRadius = '4px';
                    menu.style.padding = '4px 0';
                    menu.style.zIndex = '1000';
                    const blockItem = document.createElement('div');
                    blockItem.style.padding = '8px 16px';
                    blockItem.style.fontSize = '13px';
                    blockItem.style.cursor = 'pointer';
                    blockItem.textContent = "Don't allow to save data";
                    blockItem.onmouseenter = () => blockItem.style.backgroundColor = '#f1f3f4';
                    blockItem.onmouseleave = () => blockItem.style.backgroundColor = 'transparent';
                    blockItem.onclick = async () => {
                        await window.electronAPI.webauthnBlockCookies(domainData.domain);
                        showManageDataView();
                    };
                    menu.appendChild(blockItem);
                    const closeMenu = () => {
                        if (menu.parentNode) menu.parentNode.removeChild(menu);
                        document.removeEventListener('click', closeMenu);
                    };
                    setTimeout(() => document.addEventListener('click', closeMenu), 0);
                    row.appendChild(menu);
                };

                actions.appendChild(deleteBtn);
                actions.appendChild(menuBtn);
                row.appendChild(icon);
                row.appendChild(name);
                row.appendChild(actions);
                return row;
            };

            if (usage.main) {
                const mainHeader = document.createElement('div');
                mainHeader.style.padding = '12px 16px 4px';
                mainHeader.style.fontSize = '13px';
                mainHeader.style.color = '#202124';
                mainHeader.textContent = 'Data from the site you\'re visiting';
                scrollArea.appendChild(mainHeader);
                const mainDesc = document.createElement('div');
                mainDesc.style.padding = '0 16px 8px';
                mainDesc.style.fontSize = '13px';
                mainDesc.style.color = '#5f6368';
                mainDesc.style.lineHeight = '1.4';
                mainDesc.textContent = 'A site might save your preferred language or items you want to buy. This info is available to the site and its subdomains.';
                scrollArea.appendChild(mainDesc);
                scrollArea.appendChild(createDomainRow(usage.main, true));
            }

            if (usage.embedded && usage.embedded.length > 0) {
                const embeddedHeader = document.createElement('div');
                embeddedHeader.style.padding = '16px 16px 4px';
                embeddedHeader.style.fontSize = '13px';
                embeddedHeader.style.color = '#202124';
                embeddedHeader.textContent = 'Data from embedded sites';
                scrollArea.appendChild(embeddedHeader);
                const embeddedDesc = document.createElement('div');
                embeddedDesc.style.padding = '0 16px 8px';
                embeddedDesc.style.fontSize = '13px';
                embeddedDesc.style.color = '#5f6368';
                embeddedDesc.style.lineHeight = '1.4';
                embeddedDesc.textContent = 'A site can also embed content from other sites, for example images, ads, and text. These other sites can also save data.';
                scrollArea.appendChild(embeddedDesc);
                usage.embedded.forEach(d => { scrollArea.appendChild(createDomainRow(d, false)); });
            }

            if (!usage.main && (!usage.embedded || usage.embedded.length === 0)) {
                const empty = document.createElement('div');
                empty.style.padding = '16px';
                empty.style.fontSize = '13px';
                empty.style.color = '#5f6368';
                empty.textContent = 'No data saved';
                scrollArea.appendChild(empty);
            }
        } catch (e) {
            const err = document.createElement('div');
            err.style.padding = '16px';
            err.style.color = 'red';
            err.textContent = 'Failed to load data';
            scrollArea.appendChild(err);
        }
    }

    showMainView();
    DOM.backdrop.classList.add('co-visible');
    DOM.panel.classList.add('co-visible');
}