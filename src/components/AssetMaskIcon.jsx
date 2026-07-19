import React from 'react';

export default function AssetMaskIcon({
    icon,
    className = '',
    label = null,
    size = 16,
}) {
    return (
        <span
            className={className}
            style={{
                width: `${size}px`,
                height: `${size}px`,
                display: 'inline-block',
                flex: '0 0 auto',
                background: 'currentColor',
                mask: `url("${icon}") center / contain no-repeat`,
                WebkitMask: `url("${icon}") center / contain no-repeat`,
                verticalAlign: 'middle',
            }}
            aria-hidden={label ? undefined : true}
            aria-label={label || undefined}
        />
    );
}