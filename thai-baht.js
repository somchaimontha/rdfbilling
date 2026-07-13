/**
 * Converts a number into Thai Baht text.
 * @param {number|string} num - The number to convert
 * @returns {string} The Thai Baht text
 */
function thaiBahtText(num) {
    if (num === null || num === undefined || isNaN(Number(num))) {
        return "";
    }

    // Convert to float and round to 2 decimal places to prevent floating point issues
    const value = Math.round(parseFloat(num) * 100) / 100;
    
    if (value === 0) {
        return "ศูนย์บาทถ้วน";
    }

    const valueStr = value.toFixed(2);
    const [bahtStr, satangStr] = valueStr.split('.');

    let text = "";

    // Parse Baht part
    const bahtVal = parseInt(bahtStr, 10);
    if (bahtVal > 0) {
        text += convertSection(bahtStr) + "บาท";
    }

    // Parse Satang part
    const satangVal = parseInt(satangStr, 10);
    if (satangVal > 0) {
        text += convertSection(satangStr) + "สตางค์";
    } else {
        if (bahtVal > 0) {
            text += "ถ้วน";
        }
    }

    return text;
}

/**
 * Converts a segment of numbers (less than a million, or recursively grouped by millions)
 * @param {string} numStr 
 * @returns {string}
 */
function convertSection(numStr) {
    const digits = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
    const positions = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน", "ล้าน"];
    
    let result = "";
    const len = numStr.length;

    // Handle million groupings recursively if length > 6
    if (len > 6) {
        const millionPart = numStr.slice(0, len - 6);
        const remainderPart = numStr.slice(len - 6);
        
        result += convertSection(millionPart) + "ล้าน";
        
        // If the remainder is all zeros, don't convert it
        if (parseInt(remainderPart, 10) > 0) {
            result += convertSection(remainderPart);
        }
        return result;
    }

    for (let i = 0; i < len; i++) {
        const digit = parseInt(numStr[i], 10);
        const pos = len - i - 1;

        if (digit !== 0) {
            // Special rules for Tens (สิบ) position
            if (pos === 1) {
                if (digit === 1) {
                    result += "สิบ";
                } else if (digit === 2) {
                    result += "ยี่สิบ";
                } else {
                    result += digits[digit] + "สิบ";
                }
            } 
            // Special rules for Units (หน่วย) position when value > 9
            else if (pos === 0 && len > 1 && digit === 1) {
                // Check if previous character exists and is not '0' (meaning value is > 9)
                const prevVal = parseInt(numStr[i - 1], 10);
                if (prevVal !== 0 || (len > 2 && parseInt(numStr.slice(0, i), 10) > 0)) {
                    result += "เอ็ด";
                } else {
                    result += digits[digit];
                }
            } 
            // General rules
            else {
                result += digits[digit] + positions[pos];
            }
        }
    }

    return result;
}
