'use client';

import React, { useEffect, useState } from 'react';

const BlockOriginFilter: React.FC<{ field: any }> = ({ field }) => {
  const [options, setOptions] = useState<{ label: string; value: string }[]>([]);
  const [value, setValue] = useState('');

  useEffect(() => {
    async function fetchOrigins() {
      try {
        const res = await fetch('/api/engine/metrics/unique-origins');
        if (res.ok) {
          const data = await res.json();
          const uniqueOrigins = data.origins.map((o: string) => ({ label: o, value: o }));
          setOptions([
            { label: 'Home Feed', value: 'home' },
            { label: 'Popular Content', value: 'pop' },
            ...uniqueOrigins.filter((o: any) => o.value !== 'home' && o.value !== 'pop'),
          ]);
        }
      } catch (error) {
        console.error('Failed to fetch unique origins:', error);
      }
    }
    fetchOrigins();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    // Trigger filter update
    if (field.onChange) {
      field.onChange(newValue || undefined);
    }
  };

  return (
    <select
      value={value}
      onChange={handleChange}
      style={{
        width: '100%',
        padding: '8px 12px',
        border: '1px solid #d1d5db',
        borderRadius: '6px',
        fontSize: '14px',
        background: 'white'
      }}
    >
      <option value="">All Origins</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
};

export default BlockOriginFilter;
