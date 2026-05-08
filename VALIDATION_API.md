# Form Validation API Documentation

This document describes the validation API endpoints available on the backend for validating medical forms in the iHOMIS system.

## Base URL

```
http://localhost:3000/api/validation
```

## Overview

The validation API provides endpoints to check if all required fields in various medical forms have been completed for a specific encounter. The API queries the database (adnph_ihomis_plus) to verify data completeness.

---

## Endpoints

### 1. Validate Complete Admission Form

**Endpoint:** `GET /api/validation/admission/:enccode`

**Description:** Validates all required fields for a complete admission form entry.

**Parameters:**
- `enccode` (string, required) - The encounter code to validate

**Response:**
```json
{
  "ok": true,
  "enccode": "ENC001",
  "isComplete": true,
  "details": {
    "enccode": "ENC001",
    "vitalSigns": true,
    "bmi": true,
    "historyGDPPR": true,
    "historyCOMPL": true,
    "historyPRHIS": true,
    "historyPAHIS": true,
    "historyOCENV": true,
    "historyFAHIS": true,
    "historyDRTHE": true,
    "historyALCOH": true,
    "historyTOBAC": true,
    "historyDRUGA": true,
    "historyOTHAL": true,
    "historyOB": true,
    "prenatal": true,
    "pertinentSignSymptoms": true,
    "physicalExam": true,
    "systemReview": true,
    "courseWard": true
  },
  "missingFields": []
}
```

**Example Usage (Frontend):**
```javascript
// React example
const validateAdmission = async (enccode) => {
  try {
    const response = await fetch(`http://localhost:3000/api/validation/admission/${enccode}`);
    const data = await response.json();
    
    if (data.isComplete) {
      console.log("All admission fields are complete!");
    } else {
      console.log("Missing fields:", data.missingFields);
    }
  } catch (error) {
    console.error("Validation error:", error);
  }
};
```

---

### 2. Validate Complete Discharge Form

**Endpoint:** `GET /api/validation/discharge/:enccode`

**Description:** Validates all required fields for a complete discharge form entry.

**Parameters:**
- `enccode` (string, required) - The encounter code to validate

**Response:**
```json
{
  "ok": true,
  "enccode": "ENC001",
  "isComplete": true,
  "details": {
    "enccode": "ENC001",
    "dischargeOrder": true,
    "finalDiagnosis": true,
    "icdCode": true,
    "courseInWard": true,
    "dischargeOrderDate": "2026-05-08",
    "finalDiagnosisText": "Pneumonia",
    "icdCodeValue": "J15.9"
  },
  "missingFields": []
}
```

**Example Usage (Frontend):**
```javascript
const validateDischarge = async (enccode) => {
  try {
    const response = await fetch(`http://localhost:3000/api/validation/discharge/${enccode}`);
    const data = await response.json();
    
    if (data.isComplete) {
      console.log("Discharge form is complete!");
    } else {
      console.log("Missing fields:", data.missingFields);
      // Redirect user to complete missing fields
    }
  } catch (error) {
    console.error("Validation error:", error);
  }
};
```

---

### 3. Get Detailed Validation Results

**Endpoint:** `GET /api/validation/details/:enccode`

**Description:** Retrieves detailed validation results for all form components (both admission and discharge).

**Parameters:**
- `enccode` (string, required) - The encounter code to validate

**Response:**
```json
{
  "ok": true,
  "enccode": "ENC001",
  "validations": {
    "admission": {
      "vitalSigns": true,
      "bmi": true,
      "histories": {
        "GDPPR": true,
        "COMPL": true,
        "PRHIS": true,
        "PAHIS": true,
        "OCENV": true,
        "FAHIS": true,
        "DRTHE": true,
        "ALCOH": true,
        "TOBAC": true,
        "DRUGA": true,
        "OTHAL": true
      },
      "ob": true,
      "prenatal": true,
      "pertinentSignSymptoms": true,
      "physicalExam": true,
      "systemReview": true,
      "courseWard": true
    },
    "discharge": {
      "order": "2026-05-08",
      "finalDiagnosis": "Pneumonia",
      "icdCode": "J15.9",
      "courseInWard": true
    },
    "phic": true
  }
}
```

**Example Usage (Frontend):**
```javascript
const getFullValidationDetails = async (enccode) => {
  try {
    const response = await fetch(`http://localhost:3000/api/validation/details/${enccode}`);
    const data = await response.json();
    
    // Check specific sections
    if (!data.validations.admission.physicalExam) {
      console.log("Physical exam is missing!");
    }
    
    if (!data.validations.discharge.finalDiagnosis) {
      console.log("Final diagnosis is missing!");
    }
  } catch (error) {
    console.error("Error:", error);
  }
};
```

---

### 4. Check Specific History Type

**Endpoint:** `GET /api/validation/history/:enccode/:histype`

**Description:** Checks if a specific history type exists for an encounter.

**Parameters:**
- `enccode` (string, required) - The encounter code
- `histype` (string, required) - The history type code

**Supported History Types:**
- `GDPPR` - General Data
- `COMPL` - Chief Complaint
- `PRHIS` - History of Present Illness
- `PAHIS` - Pertinent Past Medical History
- `OCENV` - Occupation
- `FAHIS` - Family History
- `DRTHE` - Drug Therapy
- `ALCOH` - Alcohol
- `TOBAC` - Tobacco
- `DRUGA` - Drug Allergies
- `OTHAL` - Pertinent Past Other Allergies

**Response:**
```json
{
  "ok": true,
  "enccode": "ENC001",
  "histype": "COMPL",
  "exists": true
}
```

**Example Usage (Frontend):**
```javascript
const checkHistoryType = async (enccode, histype) => {
  try {
    const response = await fetch(`http://localhost:3000/api/validation/history/${enccode}/${histype}`);
    const data = await response.json();
    
    if (data.exists) {
      console.log(`${histype} history exists`);
    } else {
      console.log(`${histype} history is missing`);
    }
  } catch (error) {
    console.error("Error:", error);
  }
};

// Usage
checkHistoryType("ENC001", "COMPL");
```

---

### 5. Check PHIC Status

**Endpoint:** `GET /api/validation/phic/:enccode`

**Description:** Validates PHIC (Philippine Health Insurance Corporation) status for an encounter.

**Parameters:**
- `enccode` (string, required) - The encounter code

**Response:**
```json
{
  "ok": true,
  "enccode": "ENC001",
  "phicValid": true
}
```

**Example Usage (Frontend):**
```javascript
const validatePhic = async (enccode) => {
  try {
    const response = await fetch(`http://localhost:3000/api/validation/phic/${enccode}`);
    const data = await response.json();
    
    if (data.phicValid) {
      console.log("PHIC status is valid");
    } else {
      console.log("PHIC status is invalid");
    }
  } catch (error) {
    console.error("Error:", error);
  }
};
```

---

## Field Mappings

### Admission Form Fields

| Field | Database Table | Column(s) | Description |
|-------|---|---|---|
| Vital Signs | hvitalsign | * | Patient vital signs (BP, HR, RR, Temp, etc.) |
| BMI | hvsothr | * | Body Mass Index calculation data |
| General Data | hmrhisto | histype='GDPPR' | General patient data/demographics |
| Chief Complaint | hmrhisto | histype='COMPL' | Chief complaint information |
| History of Present Illness | hmrhisto | histype='PRHIS' | Current illness history |
| Past Medical History | hmrhisto | histype='PAHIS' | Past medical history |
| Occupation | hmrhisto | histype='OCENV' | Occupation and environment |
| Family History | hmrhisto | histype='FAHIS' | Family medical history |
| Drug Therapy | hmrhisto | histype='DRTHE' | Current drug therapy |
| Alcohol | hmrhisto | histype='ALCOH' | Alcohol use history |
| Tobacco | hmrhisto | histype='TOBAC' | Tobacco use history |
| Drug Allergies | hmrhisto | histype='DRUGA' | Drug allergies |
| Other Allergies | hmrhisto | histype='OTHAL' | Other allergies |
| OB History | hmrhistoob | obg, oblmp | Obstetric history (for OB cases only) |
| Prenatal Data | hprenatal | mcp, prenataldte2-4, expectdeliverydte | Prenatal records (for OB cases only) |
| Signs & Symptoms | hsignsymptoms, hpesignsothers | * | Patient signs and symptoms |
| Physical Exam | hphyexam | * | Physical examination findings |
| System Review | hmrsrev | * | System review findings |
| Course in Ward | hcrsward | dtetake | Daily ward course entries |

### Discharge Form Fields

| Field | Database Table | Column(s) | Description |
|-------|---|---|---|
| Discharge Order | hdocord | orcode='DISCH' | Discharge order with date |
| Final Diagnosis | hencdiag | tdcode='FINDX', primediag='Y' | Primary final diagnosis |
| ICD Code | hencdiag | tdcode='FINDX' | ICD diagnosis code |
| Course in Ward | hcrsward | dtetake | Daily entries for entire admission/stay |

---

## Error Handling

All endpoints follow a consistent error response format:

```json
{
  "error": "Error message describing what went wrong",
  "status": 500
}
```

**Common Error Scenarios:**
- Invalid or non-existent `enccode` - Returns empty arrays/false for all validations
- Database connection issues - Returns 500 error with error message
- Invalid history type - Returns false for non-existent history types

---

## Best Practices for Frontend Implementation

### 1. **Form Submission Flow**
```javascript
const handleFormSubmit = async (enccode, formType) => {
  try {
    let validationEndpoint = formType === 'admission' 
      ? `/api/validation/admission/${enccode}`
      : `/api/validation/discharge/${enccode}`;
    
    const response = await fetch(validationEndpoint);
    const data = await response.json();
    
    if (data.isComplete) {
      // Proceed with submission
      await submitForm();
    } else {
      // Show user which fields are missing
      showMissingFieldsAlert(data.missingFields);
    }
  } catch (error) {
    showErrorMessage("Could not validate form. Please try again.");
  }
};
```

### 2. **Real-time Field Validation**
```javascript
const validateSingleField = async (enccode, histype) => {
  try {
    const response = await fetch(`/api/validation/history/${enccode}/${histype}`);
    const data = await response.json();
    return data.exists;
  } catch (error) {
    console.error("Field validation error:", error);
    return false;
  }
};

// Use in form to show completion status
const updateFieldStatus = async (enccode) => {
  const historyTypes = ['COMPL', 'PRHIS', 'PAHIS', 'FAHIS'];
  for (const histype of historyTypes) {
    const isComplete = await validateSingleField(enccode, histype);
    updateUI(`field-${histype}`, isComplete);
  }
};
```

### 3. **Progress Tracking**
```javascript
const getFormProgress = async (enccode) => {
  try {
    const response = await fetch(`/api/validation/details/${enccode}`);
    const data = await response.json();
    
    const admissionFields = Object.values(data.validations.admission)
      .flat()
      .filter(val => typeof val === 'boolean');
    
    const completedCount = admissionFields.filter(val => val).length;
    const progressPercent = (completedCount / admissionFields.length) * 100;
    
    return {
      progress: progressPercent,
      completed: completedCount,
      total: admissionFields.length
    };
  } catch (error) {
    console.error("Error getting progress:", error);
  }
};
```

---

## Integration with Existing React Components

Example integration in a React form component:

```javascript
import { useState, useEffect } from 'react';

const AdmissionForm = ({ enccode }) => {
  const [validationState, setValidationState] = useState({
    isValid: false,
    missingFields: [],
    loading: true
  });

  useEffect(() => {
    const validateForm = async () => {
      try {
        const response = await fetch(
          `http://localhost:3000/api/validation/admission/${enccode}`
        );
        const data = await response.json();
        
        setValidationState({
          isValid: data.isComplete,
          missingFields: data.missingFields,
          loading: false
        });
      } catch (error) {
        console.error("Validation error:", error);
        setValidationState(prev => ({ ...prev, loading: false }));
      }
    };

    if (enccode) {
      validateForm();
    }
  }, [enccode]);

  if (validationState.loading) return <div>Loading...</div>;

  return (
    <div>
      {validationState.isValid ? (
        <div className="success">✓ Form is complete</div>
      ) : (
        <div className="warning">
          ⚠ Missing fields: {validationState.missingFields.join(', ')}
        </div>
      )}
    </div>
  );
};

export default AdmissionForm;
```

---

## Testing the API

You can test these endpoints using tools like **Postman** or **cURL**:

```bash
# Test admission validation
curl http://localhost:3000/api/validation/admission/ENC001

# Test discharge validation
curl http://localhost:3000/api/validation/discharge/ENC001

# Test specific history type
curl http://localhost:3000/api/validation/history/ENC001/COMPL

# Test PHIC status
curl http://localhost:3000/api/validation/phic/ENC001

# Get detailed validations
curl http://localhost:3000/api/validation/details/ENC001
```

---

## Performance Notes

- All database queries use indexed lookups for fast performance
- Results are returned immediately without caching
- For batch validations of multiple encounters, consider calling endpoints in parallel rather than sequentially
- The API respects existing database connections via the connection pool

---

## Support & Questions

For issues or questions about the validation API, refer to the backend README or contact the development team.
