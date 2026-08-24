# Inline State Implementation Plan (#547)

## Current State
- ✅ Connection status: inline (green/red dot)
- ✅ Project name: inline  
- ✅ Working folder chip: inline
- ❌ Generation options: hidden in Settings modal
- ❌ Conversation stats: hidden behind ℹ button

## Proposed Changes

### 1. Add inline generation parameters to header
Add a compact row below the project header showing:
- Model name (truncated if needed)
- Temperature value
- Context window usage (ContextBudget)
- Optional indicators for structured output, agentic mode

### 2. Make conversation stats always visible
Replace ℹ button with an inline chip showing key stats.

## Implementation Steps

1. **Add generation parameters to header** (in App.tsx)
   - Show model name and key params inline
   - Use ContextBudget component for context window
   - Compact layout in header area

2. **Improve conversation statistics display**
   - Move from modal to inline chip
   - Show total messages or token count
   - Click to expand details if needed

3. **Test the changes**
   - Verify all inline state is visible without clicking
   - Ensure responsive behavior on mobile
   - Check dark/light theme compatibility
