# Quick Start Guide - Form Validation API

## What Was Created

A complete **Form Validation API** on the backend that allows frontend developers to:
- ✅ Validate if admission forms are complete
- ✅ Validate if discharge forms are complete  
- ✅ Check individual form sections
- ✅ Get detailed validation results
- ✅ Check PHIC status

---

## Quick Usage

### Import in Your Frontend

```javascript
// Base URL for all validation endpoints
const VALIDATION_BASE_URL = 'http://localhost:3000/api/validation';
```

### 1. Check if Admission is Complete

```javascript
const isAdmissionComplete = async (enccode) => {
  const response = await fetch(`${VALIDATION_BASE_URL}/admission/${enccode}`);
  const data = await response.json();
  return data.isComplete; // true or false
};
```

### 2. Check if Discharge is Complete

```javascript
const isDischargComplete = async (enccode) => {
  const response = await fetch(`${VALIDATION_BASE_URL}/discharge/${enccode}`);
  const data = await response.json();
  return data.isComplete; // true or false
};
```

### 3. Get All Validation Details

```javascript
const getAllValidations = async (enccode) => {
  const response = await fetch(`${VALIDATION_BASE_URL}/details/${enccode}`);
  const data = await response.json();
  return data.validations; // All validation info
};
```

### 4. Show User What's Missing

```javascript
const showMissingFields = async (enccode) => {
  const response = await fetch(`${VALIDATION_BASE_URL}/admission/${enccode}`);
  const data = await response.json();
  
  if (!data.isComplete) {
    console.log('Please complete these sections:');
    data.missingFields.forEach(field => {
      console.log(`  - ${field}`);
    });
  }
};
```

---

## React Component Example

```jsx
import { useState, useEffect } from 'react';

function FormValidationStatus({ enccode }) {
  const [validation, setValidation] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const validate = async () => {
      try {
        const response = await fetch(
          `http://localhost:3000/api/validation/admission/${enccode}`
        );
        const data = await response.json();
        setValidation(data);
      } catch (error) {
        console.error('Validation error:', error);
      } finally {
        setLoading(false);
      }
    };

    if (enccode) validate();
  }, [enccode]);

  if (loading) return <p>Checking form status...</p>;
  if (!validation) return <p>Error loading validation</p>;

  return (
    <div className="validation-status">
      {validation.isComplete ? (
        <div className="complete">
          ✓ Form is complete - Ready to submit!
        </div>
      ) : (
        <div className="incomplete">
          ✗ Form incomplete - Missing sections:
          <ul>
            {validation.missingFields.map(field => (
              <li key={field}>{field}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default FormValidationStatus;
```

---

## API Endpoints Reference

| Endpoint | Purpose | Returns |
|----------|---------|---------|
| `GET /admission/:enccode` | Check admission complete | `{ isComplete: boolean, missingFields: [] }` |
| `GET /discharge/:enccode` | Check discharge complete | `{ isComplete: boolean, missingFields: [] }` |
| `GET /details/:enccode` | Get all validation details | Full validation object |
| `GET /history/:enccode/:histype` | Check history type | `{ exists: boolean }` |
| `GET /phic/:enccode` | Check PHIC status | `{ phicValid: boolean }` |

---

## Common Patterns

### Pattern 1: Form Submission Flow
```javascript
async function handleSubmit(enccode, formType) {
  const endpoint = formType === 'admission' 
    ? `/admission/${enccode}`
    : `/discharge/${enccode}`;
  
  const response = await fetch(`${VALIDATION_BASE_URL}${endpoint}`);
  const { isComplete, missingFields } = await response.json();
  
  if (isComplete) {
    // Submit form
  } else {
    // Show alert with missing fields
    alert(`Please complete: ${missingFields.join(', ')}`);
  }
}
```

### Pattern 2: Real-time Progress
```javascript
async function getFormProgress(enccode) {
  const response = await fetch(`${VALIDATION_BASE_URL}/details/${enccode}`);
  const { validations } = await response.json();
  
  const allFields = [
    ...Object.values(validations.admission),
    ...Object.values(validations.discharge)
  ].flat();
  
  const completed = allFields.filter(v => v).length;
  return Math.round((completed / allFields.length) * 100);
}
```

### Pattern 3: Field-by-Field Validation
```javascript
const historyTypes = ['COMPL', 'PRHIS', 'PAHIS', 'FAHIS', 'DRTHE'];

async function checkHistoryFields(enccode) {
  const results = {};
  
  for (const histype of historyTypes) {
    const response = await fetch(
      `${VALIDATION_BASE_URL}/history/${enccode}/${histype}`
    );
    const { exists } = await response.json();
    results[histype] = exists;
  }
  
  return results;
}
```

---

## Database Connection Info

The API uses the same database as your backend:
- **Database:** adnph_ihomis_plus
- **Host:** 180.232.187.222
- **Port:** 3306
- **User:** root

No additional configuration needed - all database queries are handled by the API!

---

## Testing Your Integration

Use this in browser console to test:

```javascript
// Test admission
fetch('http://localhost:3000/api/validation/admission/ENC001')
  .then(r => r.json())
  .then(d => console.log(d));

// Test discharge  
fetch('http://localhost:3000/api/validation/discharge/ENC001')
  .then(r => r.json())
  .then(d => console.log(d));

// Test details
fetch('http://localhost:3000/api/validation/details/ENC001')
  .then(r => r.json())
  .then(d => console.log(d));
```

---

## Error Handling

```javascript
async function validateWithErrorHandling(enccode) {
  try {
    const response = await fetch(
      `http://localhost:3000/api/validation/admission/${enccode}`
    );
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Validation failed:', error);
    // Show user-friendly error message
    return { error: 'Unable to validate form. Please try again.' };
  }
}
```

---

## File Locations (Backend)

- **Controller:** `src/controllers/validationController.js`
- **Routes:** `src/routes/validationRoutes.js`
- **Full Docs:** `VALIDATION_API.md`

All files are already integrated into the Express server!

---

## Next Steps

1. ✅ Backend API is ready to use
2. 📝 Import endpoints in your React components
3. 🔄 Use the validation functions in your form submission flows
4. ✓ Test with actual encounter codes from your database

Start calling the API endpoints from your frontend - they're ready to go! 🚀
